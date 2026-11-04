-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 189 — Status do TOA: o que já andou não é encerrado pelo TOA, e o     │
-- │       status posto à mão não volta                                   │
-- │                                                                      │
-- │ Emanuel, 03/11: "se teve status o sistema leva o contrato até em     │
-- │ execução, depois disso o técnico precisa baixar manual (...) agora   │
-- │ quando não há movimentação de status, o sistema pode puxar o         │
-- │ contrato direto pra cancelado, ou auditar." O caso: o técnico pede   │
-- │ ao cliente que cancele; o contrato sai da linha dele no TOA e virava │
-- │ Cancelada sozinho, sem a baixa dele.                                 │
-- │                                                                      │
-- │ O de/para do status já era o pedido (em rota → deslocamento,         │
-- │ pendente → entrada, iniciado → execução; concluído/não concluído →   │
-- │ execução + código) e não muda. Perguntado e respondido:              │
-- │  · alcance: "Só cancelado e sumiu" — concluído com código continua   │
-- │    fechando sozinho (7 dias: ~1.410 contratos com movimento fechados │
-- │    pelo código; técnicos deram baixa em 2);                          │
-- │  · status manual: "Vale o do técnico" — a importação não faz voltar. │
-- │                                                                      │
-- │ importar_toa_interno: CANCELADO no TOA + já esteve em deslocamento/  │
-- │   execução (evento, situação atual ou mão de alguém) → Em execução,  │
-- │   sem baixa automática, com UM aviso ao técnico. 7 dias: 12 casos.   │
-- │   E contrato tocado à mão não volta de status pela importação.       │
-- │ desatribuir_ausentes: em deslocamento e sumiu → Em execução (antes:  │
-- │   só acusava). Em execução continua; Entrada continua indo a Auditar │
-- │   (D-191); Atribuída e Ticket de suporte continuam só acusados.      │
-- │                                                                      │
-- │ Corpos copiados das funções VIVAS (md5 conferido com a 187).         │
-- └──────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.importar_toa_interno(p_importacao_id uuid, p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; d jsonb;
  v_base uuid; v_id uuid; v_atividade text; v_bloqueada boolean;
  v_tecnico uuid; v_equipe uuid; v_atual text; v_data date;
  v_usuario uuid; v_arquivo text; v_login text; v_nova text;
  j int; v_num_os text; v_cod integer;
  v_baixa_auto boolean := false; v_sit_baixa text; v_sit_agora text;
  v_auto_aqui boolean;  -- 128: a baixa automática vale para ESTE contrato?
  v_desatrib boolean;   -- 184: encerrado pelo 800 do próprio sistema (D-191)?
  v_terminais text[] := situacoes_terminais();  -- 184: uma vez, não por linha
  v_segura boolean;     -- 189: cancelado no TOA depois de andar -- segura em execução
  c_obs_segura constant text :=
    'Cancelado no TOA depois de iniciado: fica em execução até você dar a baixa.';
  -- 090: o dia de atuação, escolhido por quem importa
  v_dia date; v_dia_antes date; v_dia_planilha date;
  n_criadas int := 0; n_atualiz int := 0; n_ignor int := 0;
  n_erro int := 0; n_conflito int := 0; n_os int := 0; n_susp int := 0;
  resumo jsonb;
  n_pela_wo int := 0;   -- 187: linhas cujo ID veio da WO do dia
begin
  perform set_config('app.origem', 'IMPORTACAO', true);

  -- Baixa automatica: o sistema aplica sozinho a situacao que o
  -- codigo do TOA significa. Nasce desligada; quem liga e o ADMIN,
  -- em Configuracoes.
  select coalesce(p.valor = 'true'::jsonb, false) into v_baixa_auto
    from importacao i
    join base b on b.id = i.base_id
    join parametro p on p.empresa_id = b.empresa_id and p.chave = 'baixa_automatica'
   where i.id = p_importacao_id;

  select base_id, usuario_id, arquivo_nome, data_atuacao
    into v_base, v_usuario, v_arquivo, v_dia
    from importacao where id = p_importacao_id;
  if v_base is null then
    raise exception 'Importacao % nao encontrada', p_importacao_id;
  end if;
  -- 090: sem escolha gravada, e HOJE em Manaus -- nunca a data da planilha.
  v_dia := coalesce(v_dia, hoje_local());

  -- ┌─ 187: planilha SEM a coluna "ID da Atividade" ──────────────────┐
  -- │ O TOA deixa cada um montar as colunas da exportação, e em 03/11 │
  -- │ veio um arquivo do MAN-AFLINE_01_VT sem o ID — todas as linhas  │
  -- │ caíam em "Sem ID da Atividade". O ID se acha pela WO: no MESMO  │
  -- │ dia de atuação e na MESMA cidade a WO aponta uma atividade só   │
  -- │ (medido no histórico inteiro: 0 casos de WO com dois IDs no dia).│
  -- │                                                                  │
  -- │ Só se COMPLETA o que já existe: WO sem contrato no dia continua │
  -- │ sem ID e fica de fora, com o porquê. Inventar uma chave criaria │
  -- │ o contrato em dobro quando a planilha certa chegasse (D-004).   │
  -- │ O ID vai para a LINHA, não só para a variável: a reconciliação  │
  -- │ (`desatribuir_ausentes`) lê a linha — sem ele, a rota inteira   │
  -- │ pareceria ter sumido do TOA.                                     │
  -- └──────────────────────────────────────────────────────────────────┘
  with achado as (
    select l.id, min(v.toa_atividade_id) as atividade
      from importacao_linha l
      join visita v on v.base_id = v_base and v.data_agendada = v_dia
                   and v.wo_numero = btrim(l.dados ->> 'Número da WO')
                   and v.toa_atividade_id is not null
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados ->> 'ID da Atividade', '')), '') is null
       and nullif(btrim(coalesce(l.dados ->> 'Número da WO', '')), '') is not null
     group by l.id
    having count(distinct v.toa_atividade_id) = 1
  )
  update importacao_linha l
     set dados = l.dados || jsonb_build_object('ID da Atividade', a.atividade)
    from achado a
   where l.id = a.id;
  get diagnostics n_pela_wo = row_count;

  for r in
    select id, numero_linha, dados from importacao_linha
    where importacao_id = p_importacao_id order by numero_linha
  loop
    begin
      d := r.dados;
      v_atividade := j_txt(d, 'ID da Atividade');

      if v_atividade is null then
        n_ignor := n_ignor + 1;
        update importacao_linha set resultado = 'IGNORADA',
          mensagem = case
            when j_txt(d, 'Número da WO') is not null
              then 'Sem ID da Atividade, e nenhum contrato deste dia com esta WO: contrato novo so entra pela planilha com o ID'
            else 'Sem ID da Atividade' end
          where id = r.id;
        continue;
      end if;

      -- Suspensa e tentativa abortada: sem baixa, sem O.S.
      -- executada, sem trabalho feito. Nao entra (051).
      if norm_txt(coalesce(j_txt(d, 'Status da Atividade'),'')) = 'SUSPENSO' then
        n_susp := n_susp + 1;
        update importacao_linha set resultado = 'IGNORADA',
          mensagem = 'Atividade suspensa -- nao aconteceu' where id = r.id;
        continue;
      end if;

      v_login := j_txt(d, 'Login do Técnico');
      -- 090: o dia e o da importacao. A "Data" da planilha so vai para
      -- a trilha (evento), e continua inteira em dados_origem.
      v_data  := v_dia;
      v_dia_planilha := j_data(d, 'Data');

      -- QUEM MANDA E O CADASTRO. `equipe_do_login` consulta, nesta
      -- ordem: o historico de login da equipe na data, o login corrente
      -- da equipe, e so por ultimo a matricula do tecnico. Antes daqui
      -- a importacao usava SO o ultimo criterio, e por isso ignorava o
      -- que o usuario tinha cadastrado.
      v_equipe  := equipe_do_contrato(v_base, v_login, v_data);
      -- ┌─ 070: a AREA DE TRABALHO entra no catalogo ─────────────┐
      -- │ A planilha traz "ARN-AREA01". O catalogo so tinha MA1..  │
      -- │ MA5 (Manaus), entao o `select` nao achava e a coluna     │
      -- │ ficava NULA -- perdendo um dado que estava no arquivo.   │
      -- │ Agora o catalogo aprende com a planilha, que e a fonte.  │
      -- └─────────────────────────────────────────────────────────┘
      if nullif(btrim(coalesce(j_txt(d, 'Área de Trabalho'), '')), '') is not null then
        insert into area_trabalho (codigo, apelido, base_id, empresa_id)
        values (btrim(j_txt(d, 'Área de Trabalho')),
                btrim(j_txt(d, 'Área de Trabalho')),
                v_base, (select empresa_id from base where id = v_base))
        on conflict (codigo) do nothing;
      end if;


      v_tecnico := null;
      select t.id into v_tecnico
      from tecnico t
      where t.base_id = v_base
        and norm_txt(t.matricula) = norm_txt(v_login)
      limit 1;

      v_id := null; v_bloqueada := null; v_atual := null; v_dia_antes := null;
      v_desatrib := null;
      select v.id, v.bloqueado_em is not null, v.situacao, v.data_agendada,
             v.desatribuido_em is not null
        into v_id, v_bloqueada, v_atual, v_dia_antes, v_desatrib
      from visita v
      -- 095: a atividade do TOA e unica POR DIA. O mesmo arquivo importado
      -- em outro dia gera contratos NOVOS nesse dia, sem puxar o historico.
      where v.base_id = v_base and v.toa_atividade_id = v_atividade
        and v.data_agendada = v_dia;

      v_nova := situacao_do_toa(j_txt(d, 'Status da Atividade'));

      -- 128: a baixa automática vale para o contrato que o campo NÃO BAIXOU
      -- (Emanuel, 24/10). Tocado pelo campo só protege quem deu baixa da
      -- AFLINE em alguma O.S. (D-006).
      v_auto_aqui := v_baixa_auto and (not coalesce(v_bloqueada, false)
        or not exists (select 1 from ordem_servico o
                        where o.visita_id = v_id and o.codigo_baixa_afline_id is not null));
      -- 128: sem o vai-e-volta. Com TODAS as O.S. já com código, a baixa
      -- automática no fim SEMPRE leva à situação do código, qualquer que
      -- seja o status do TOA ("concluído", ou "iniciado" de quem reabriu a
      -- atividade — traps.md). Então grava essa situação desde a primeira
      -- escrita: mesmo resultado, sem 2 eventos e 2 avisos por importação.
      if v_id is not null and v_auto_aqui then
        v_nova := coalesce(situacao_da_baixa(v_id), v_nova);
      end if;

      -- 184: encerrado não reabre (Emanuel, 03/11). Só o CÓDIGO muda um
      -- encerrado, e só para outro encerrado: a baixa automática, quando
      -- vale para este contrato. O status do TOA ("concluído" = EM_EXECUCAO
      -- em situacao_do_toa) passava por cima da Concluída que o campo deu.
      -- O Desatribuído do próprio sistema volta quando reaparece (D-191).
      if v_id is not null and v_atual = any(v_terminais)
         and not coalesce(v_desatrib, false) then
        v_nova := case when v_auto_aqui
                       then coalesce(situacao_da_baixa(v_id), v_atual)
                       else v_atual end;
      end if;

      -- ┌─ 189: o TOA não encerra o que já ANDOU (Emanuel, 03/11) ─────────┐
      -- │ "se teve status o sistema leva o contrato até em execução,       │
      -- │  depois disso o técnico precisa baixar manual (...) quando não   │
      -- │  há movimentação de status, o sistema pode puxar o contrato      │
      -- │  direto pra cancelado". O técnico às vezes pede ao cliente que   │
      -- │  cancele; o contrato sai da linha dele no TOA e virava Cancelada │
      -- │  sozinho. Agora: CANCELADO no TOA + o contrato já esteve em      │
      -- │  deslocamento/execução (pela importação ou pela mão de alguém)   │
      -- │  → fica em Em execução, sem baixa automática, até a baixa do     │
      -- │  técnico. Sem movimento, cancela como sempre. Concluído com      │
      -- │  código continua fechando sozinho (perguntado: "Só cancelado e   │
      -- │  sumiu"). Encerrado não reabre (184) — por isso só fora dele.    │
      -- └──────────────────────────────────────────────────────────────────┘
      v_segura := false;
      if v_id is not null and not (v_atual = any(v_terminais))
         and norm_txt(coalesce(j_txt(d, 'Status da Atividade'), '')) = 'CANCELADO'
         and (coalesce(v_bloqueada, false)
              or v_atual in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
              or exists (select 1 from visita_evento e
                          where e.visita_id = v_id
                            and e.para ->> 'situacao' in ('EM_DESLOCAMENTO', 'EM_EXECUCAO'))) then
        v_segura    := true;
        v_auto_aqui := false;
        -- o Ticket de suporte (COM_IMPEDIMENTO) é pedido do técnico: fica
        v_nova := case when v_atual in ('EM_EXECUCAO', 'COM_IMPEDIMENTO')
                       then v_atual else 'EM_EXECUCAO' end;
      end if;

      -- 189: o status que alguém pôs à mão (bloqueado_em) não VOLTA pela
      -- importação — "Vale o do técnico" (Emanuel, 03/11). O TOA ainda em
      -- rota/pendente não desfaz o "cheguei". Avançar pode, até Em execução;
      -- encerrar continua sendo pelo código ou pela baixa.
      if v_id is not null and coalesce(v_bloqueada, false)
         and not (v_atual = any(v_terminais)) and not (v_nova = any(v_terminais))
         and (case v_nova when 'ATRIBUIDA' then 1 when 'EM_DESLOCAMENTO' then 2
                          when 'EM_EXECUCAO' then 3 when 'COM_IMPEDIMENTO' then 3 else 0 end)
             <= (case v_atual when 'ATRIBUIDA' then 1 when 'EM_DESLOCAMENTO' then 2
                              when 'EM_EXECUCAO' then 3 when 'COM_IMPEDIMENTO' then 3 else 0 end) then
        v_nova := v_atual;
      end if;

      if v_id is null then
        insert into visita (
          base_id, toa_atividade_id, origem, wo_numero, contrato,
          tipo_atividade_id, area_id, segmentacao_id, categoria_id,
          node, workzone_key,
          logradouro, complemento, bairro, cidade, uf, cep,
          lat, lng, codigo_ibge,
          data_agendada, janela_inicio, janela_fim,
          equipe_id, tecnico_responsavel_id,
          situacao, situacao_em, inicio, fim, tempo_deslocamento,
          importacao_id, dados_origem
        ) values (
          v_base, v_atividade, 'TOA',
          j_txt(d,'Número da WO'), j_txt(d,'Contrato'),
          (select id from tipo_atividade
             where norm_txt(nome) = norm_txt(j_txt(d,'Tipo de Atividade__2'))),
          (select id from area_trabalho
             where norm_txt(codigo) = norm_txt(j_txt(d,'Área de Trabalho'))),
          (select id from segmentacao
             where norm_txt(nome) = norm_txt(j_txt(d,'Segmentação'))),
          (select id from categoria_capacidade
             where norm_txt(nome) = norm_txt(j_txt(d,'Categorias da Capacidade'))),
          j_txt(d,'Node'), j_txt(d,'Workzone key'),
          j_txt(d,'Endereço'), j_txt(d,'Complemento Endereço'),
          j_txt(d,'Bairro'), j_txt(d,'Cidade'), left(j_txt(d,'UF'),2),
          j_txt(d,'CEP/Código Postal'),
          j_num(d,'Coordenada Y'), j_num(d,'Coordenada X'),
          j_txt(d,'Código IBGE'),
          v_data,
          j_hora(d,'Intervalo de Tempo',1), j_hora(d,'Intervalo de Tempo',2),
          v_equipe, v_tecnico,
          v_nova, now(),
          j_ts_no_dia(d, v_dia, 'Início'), j_ts_no_dia(d, v_dia, 'Fim'),
          j_interv(d,'Tempo de Deslocamento'),
          p_importacao_id, d
        ) returning id into v_id;

        n_criadas := n_criadas + 1;
        update importacao_linha set resultado = 'CRIADA', visita_id = v_id
          where id = r.id;

        insert into visita_evento (visita_id, tipo, para, origem,
                                   usuario_id, login, importacao_id, observacao,
                                   equipe_id, tecnico_id)
        values (v_id, 'IMPORTADA',
                jsonb_build_object('atividade', v_atividade, 'situacao', v_nova,
                                   'dia', v_dia)
                || case when v_dia_planilha is distinct from v_dia
                        then jsonb_build_object('data_planilha', v_dia_planilha)
                        else '{}'::jsonb end,
                'IMPORTACAO', v_usuario, v_login, p_importacao_id, v_arquivo,
                v_equipe, v_tecnico);

      else
        -- 095: nao ha mais "mudar de dia" -- a busca ja e pelo dia (acima).

        if v_bloqueada then
          -- D-006 continua protegendo o TRABALHO do campo (baixa, foto,
          -- observacao). O STATUS, nao: o sistema e espelho do TOA, e
          -- status que nao espelha nao serve para despachar. O conflito
          -- continua sendo gravado, entao nada se perde da trilha.
          update visita set
            wo_numero   = coalesce(j_txt(d,'Número da WO'), wo_numero),
            contrato    = coalesce(j_txt(d,'Contrato'), contrato),
            logradouro  = coalesce(j_txt(d,'Endereço'), logradouro),
            complemento = coalesce(j_txt(d,'Complemento Endereço'), complemento),
            bairro      = coalesce(j_txt(d,'Bairro'), bairro),
            cidade      = coalesce(j_txt(d,'Cidade'), cidade),
            cep         = coalesce(j_txt(d,'CEP/Código Postal'), cep),
            lat         = coalesce(j_num(d,'Coordenada Y'), lat),
            lng         = coalesce(j_num(d,'Coordenada X'), lng),
            -- 071: a AREA tambem na ATUALIZACAO. Ela so era gravada no
            -- INSERT, entao visita importada antes de a area existir no
            -- catalogo ficava sem area PARA SEMPRE -- reimportar nao
            -- consertava. `coalesce` para nunca apagar o que ja havia.
            area_id = coalesce((select id from area_trabalho
                                 where norm_txt(codigo) = norm_txt(j_txt(d, 'Área de Trabalho'))),
                               area_id),
            segmentacao_id = coalesce((select id from segmentacao
               where norm_txt(nome) = norm_txt(j_txt(d,'Segmentação'))), segmentacao_id),
            data_agendada  = v_dia,
            janela_inicio  = coalesce(j_hora(d,'Intervalo de Tempo',1), janela_inicio),
            janela_fim     = coalesce(j_hora(d,'Intervalo de Tempo',2), janela_fim),
            situacao       = v_nova,
            situacao_em    = case when v_nova is distinct from v_atual
                                  then now() else situacao_em end,
            -- 128: a hora e a linha do TOA também no contrato tocado pelo
            -- campo — são do TOA, não trabalho do campo (D-006 protege a baixa).
            inicio = coalesce(j_ts_no_dia(d, v_dia, 'Início'), inicio),
            fim    = coalesce(j_ts_no_dia(d, v_dia, 'Fim'), fim),
            tempo_deslocamento = coalesce(j_interv(d,'Tempo de Deslocamento'), tempo_deslocamento),
            dados_origem = d
          where id = v_id;

          if v_nova is distinct from v_atual and not v_segura then  -- 189: o aviso é o de baixo
            n_conflito := n_conflito + 1;
            insert into visita_evento (visita_id, tipo, de, para, origem,
                                       usuario_id, login, importacao_id,
                                       equipe_id, tecnico_id, observacao)
            values (v_id, 'CONFLITO_TOA',
              jsonb_build_object('situacao', v_atual),
              jsonb_build_object('situacao', v_nova,
                                 'toa', j_txt(d,'Status da Atividade')),
              'IMPORTACAO', v_usuario, v_login, p_importacao_id,
              v_equipe, v_tecnico,
              'O TOA sobrepos a situacao registrada em campo');
            update importacao_linha set resultado = 'CONFLITO',
              mensagem = 'TOA sobrepos a situacao do campo', visita_id = v_id
              where id = r.id;
          else
            update importacao_linha set resultado = 'ATUALIZADA', visita_id = v_id
              where id = r.id;
          end if;

        else
          update visita set
            wo_numero   = coalesce(j_txt(d,'Número da WO'), wo_numero),
            contrato    = coalesce(j_txt(d,'Contrato'), contrato),
            logradouro  = coalesce(j_txt(d,'Endereço'), logradouro),
            complemento = coalesce(j_txt(d,'Complemento Endereço'), complemento),
            bairro      = coalesce(j_txt(d,'Bairro'), bairro),
            cidade      = coalesce(j_txt(d,'Cidade'), cidade),
            cep         = coalesce(j_txt(d,'CEP/Código Postal'), cep),
            lat         = coalesce(j_num(d,'Coordenada Y'), lat),
            lng         = coalesce(j_num(d,'Coordenada X'), lng),
            data_agendada = v_dia,
            janela_inicio = coalesce(j_hora(d,'Intervalo de Tempo',1), janela_inicio),
            janela_fim    = coalesce(j_hora(d,'Intervalo de Tempo',2), janela_fim),
            -- 071: a AREA tambem na ATUALIZACAO. Ela so era gravada no
            -- INSERT, entao visita importada antes de a area existir no
            -- catalogo ficava sem area PARA SEMPRE -- reimportar nao
            -- consertava. `coalesce` para nunca apagar o que ja havia.
            area_id = coalesce((select id from area_trabalho
                                 where norm_txt(codigo) = norm_txt(j_txt(d, 'Área de Trabalho'))),
                               area_id),
            equipe_id     = case when rota_fixada_em is not null then equipe_id
                                 else coalesce(v_equipe, equipe_id) end,
            tecnico_responsavel_id = case when rota_fixada_em is not null
                                          then tecnico_responsavel_id
                                          else coalesce(v_tecnico, tecnico_responsavel_id) end,
            situacao      = v_nova,
            situacao_em   = now(),
            -- 090: a hora da planilha, no dia de atuacao. Mudando o dia,
            -- o inicio antigo mudaria junto -- por isso nao e coalesce
            -- com a data velha quando o dia muda.
            inicio        = coalesce(j_ts_no_dia(d, v_dia, 'Início'),
                                     case when v_dia_antes is not distinct from v_dia
                                          then inicio end),
            fim           = coalesce(j_ts_no_dia(d, v_dia, 'Fim'),
                                     case when v_dia_antes is not distinct from v_dia
                                          then fim end),
            tempo_deslocamento = coalesce(j_interv(d,'Tempo de Deslocamento'), tempo_deslocamento),
            dados_origem  = d
          where id = v_id;

          if v_nova is distinct from v_atual and not v_segura then  -- 189: o aviso é o de baixo
            insert into visita_evento (visita_id, tipo, de, para, origem,
                                       usuario_id, login, importacao_id,
                                       equipe_id, tecnico_id)
            values (v_id, 'SITUACAO',
                    jsonb_build_object('situacao', v_atual),
                    jsonb_build_object('situacao', v_nova),
                    'IMPORTACAO', v_usuario, v_login, p_importacao_id,
                    v_equipe, v_tecnico);
          end if;

          update importacao_linha set resultado = 'ATUALIZADA', visita_id = v_id
            where id = r.id;
        end if;

        n_atualiz := n_atualiz + 1;

        -- 189: o técnico fica sabendo UMA vez (a importação roda a cada 15 min)
        if v_segura and not exists (select 1 from visita_evento e
                                     where e.visita_id = v_id and e.tipo = 'CONFLITO_TOA'
                                       and e.observacao = c_obs_segura) then
          insert into visita_evento (visita_id, tipo, de, para, origem,
                                     usuario_id, login, importacao_id,
                                     equipe_id, tecnico_id, observacao)
          values (v_id, 'CONFLITO_TOA',
                  jsonb_build_object('situacao', v_atual),
                  jsonb_build_object('situacao', v_nova, 'toa', j_txt(d, 'Status da Atividade')),
                  'IMPORTACAO', v_usuario, v_login, p_importacao_id,
                  v_equipe, v_tecnico, c_obs_segura);
          insert into aviso (empresa_id, equipe_id, visita_id, tipo, titulo, detalhe,
                             contrato, servico, situacao_de, situacao_para)
          select v.empresa_id, v.equipe_id, v.id, 'CANCELADO_OPERADORA',
                 'Cancelado no TOA — dê a baixa', c_obs_segura, v.contrato,
                 coalesce(ts.nome, ta.nome, 'Contrato'), v_atual, v_nova
            from visita v
            left join tipo_servico ts on ts.id = v.tipo_servico_id
            left join tipo_atividade ta on ta.id = v.tipo_atividade_id
           where v.id = v_id and v.equipe_id is not null;
        end if;
      end if;

      for j in 1..10 loop
        v_num_os := j_txt(d, 'Número da O.S ' || j);
        continue when v_num_os is null;
                -- ┌─ 070: o TIPO DA O.S. entra no catalogo ───────────────┐
        -- │ "87 - RETIRAR EMTA": o numero e o codigo, o resto e o  │
        -- │ nome. Sem o tipo no catalogo a O.S. aparecia como "—"  │
        -- │ na tela, com o nome ali, no arquivo, sem ser lido.     │
        -- │                                                       │
        -- │ So entra quando ha DESCRICAO de verdade: se a celula   │
        -- │ trouxer so o numero, nada e inventado -- fica nulo, e  │
        -- │ a tela continua dizendo que nao sabe.                  │
        -- └───────────────────────────────────────────────────────┘
        if extrai_codigo(j_txt(d, 'Tipo O.S ' || j)) is not null then
          insert into tipo_os (codigo, descricao, empresa_id)
          select extrai_codigo(j_txt(d, 'Tipo O.S ' || j)),
                 btrim(regexp_replace(j_txt(d, 'Tipo O.S ' || j),
                                      '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*', '')),
                 (select empresa_id from base where id = v_base)
           where btrim(regexp_replace(j_txt(d, 'Tipo O.S ' || j),
                        '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*', '')) <> ''
             and btrim(regexp_replace(j_txt(d, 'Tipo O.S ' || j),
                        '^[[:space:]]*[0-9]+[[:space:]]*-[[:space:]]*', ''))
                 <> btrim(j_txt(d, 'Tipo O.S ' || j))
          on conflict (codigo) do nothing;
        end if;

        v_cod := extrai_codigo(j_txt(d, 'Cód de Baixa ' || j));

        insert into ordem_servico (
          visita_id, sequencia, numero_os, ponto, tipo_os_id,
          status_operadora, codigo_baixa_id, produto, origem, descricao
        ) values (
          v_id, j, v_num_os, j_txt(d, 'Ponto ' || j),
          (select id from tipo_os
             where codigo = extrai_codigo(j_txt(d, 'Tipo O.S ' || j))),
          case norm_txt(j_txt(d, 'Status da O.S ' || j))
            when 'EXECUTADA' then 'EXECUTADA'
            when 'NAO EXECUTADA' then 'NAO_EXECUTADA'
            else null end,
          (select id from codigo_baixa where codigo = v_cod),
          j_txt(d, 'Produto'), 'TOA',
          (select descricao from tipo_os
             where codigo = extrai_codigo(j_txt(d, 'Tipo O.S ' || j)))
        )
        on conflict (visita_id, sequencia) do update set
          numero_os        = excluded.numero_os,
          ponto            = excluded.ponto,
          tipo_os_id       = excluded.tipo_os_id,
          -- O codigo da OPERADORA e espelho: se o TOA mudou, o nosso muda.
          -- A baixa da AFLINE (`codigo_baixa_afline_id`) nao e tocada.
          status_operadora = coalesce(excluded.status_operadora, ordem_servico.status_operadora),
          codigo_baixa_id  = coalesce(excluded.codigo_baixa_id, ordem_servico.codigo_baixa_id),
          descricao        = coalesce(ordem_servico.descricao, excluded.descricao);

        n_os := n_os + 1;
      end loop;

      -- TEC1: aderencia a janela (047). Medicao, nao decisao --
      -- por isso roda sempre, independente da baixa automatica.
      perform extrair_produtos(v_id);
      update visita set tec1 = tec1_da_visita(v_id),
             finalizado_toa = norm_txt(coalesce(j_txt(d, 'Status da Atividade'),''))
                              in ('CONCLUIDO','NAO CONCLUIDO')
       where id = v_id;

      -- A situacao sai do CODIGO, nao do status: EXECUTADA virou
      -- Reagendamento 1.075 vezes e Cancelado 657 no analitico do
      -- ngestor. So aplica quando TODAS as O.S. da visita tem codigo
      -- com destino declarado -- meia baixa nao e baixa. Contrato
      -- tocado pelo campo (bloqueado_em) nao e sobrescrito, e a
      -- mudanca deixa evento: situacao que muda sozinha sem registro
      -- e a que ninguem consegue explicar depois.
      if v_auto_aqui then  -- 128 (antes: not v_bloqueada)
        v_sit_baixa := situacao_da_baixa(v_id);
        select situacao into v_sit_agora from visita where id = v_id;
        if v_sit_baixa is not null and v_sit_baixa is distinct from v_sit_agora then
          insert into visita_evento (visita_id, tipo, de, para, origem, observacao,
                                     importacao_id)
          values (v_id, 'SITUACAO',
                  jsonb_build_object('situacao', v_sit_agora),
                  jsonb_build_object('situacao', v_sit_baixa),
                  'IMPORTACAO', 'Baixa automatica pelo codigo de baixa do TOA',
                  p_importacao_id);
          update visita set situacao = v_sit_baixa, situacao_em = now()
           where id = v_id;
        end if;
      end if;

    exception when others then
      n_erro := n_erro + 1;
      update importacao_linha set resultado = 'ERRO', mensagem = SQLERRM
      where id = r.id;
    end;
  end loop;

  resumo := jsonb_build_object(
    'criadas', n_criadas, 'atualizadas', n_atualiz,
    'ignoradas', n_ignor, 'erros', n_erro,
    'conflitos', n_conflito, 'ordens_servico', n_os,
    'suspensas', n_susp,
    'id_pela_wo', n_pela_wo,
    'dia', v_dia,
    'simulacao', p_simular);

  perform set_config('app.origem', '', true);

  if p_simular then
    raise exception using errcode = 'P0001',
      message = 'PREVIA:' || resumo::text;
  end if;

  update importacao set
    status = 'APLICADA', aplicado_em = now(),
    data_atuacao = v_dia,
    qtd_criadas = n_criadas, qtd_atualizadas = n_atualiz,
    qtd_ignoradas = n_ignor, qtd_erro = n_erro, qtd_conflito = n_conflito
  where id = p_importacao_id;

  return resumo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.desatribuir_ausentes(p_importacao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_imp  importacao;
  v_dia  date;
  v_800  uuid;
  v_eu   uuid := auth.uid();
  n_des  int := 0;
  n_dev  int := 0;
  n_sum  int := 0;
  n_vol  int := 0;
  r      record;
  c_obs_des constant text := 'Saiu da sua rota no TOA: desatribuído automaticamente (cód. 800).';
  c_obs_dev constant text := 'Voltou para a rota no TOA: de volta Na entrada.';
  c_obs_sum constant text :=
    'Sumiu da planilha do TOA enquanto estava em andamento. Nada foi alterado: confira no TOA e corrija à mão.';
  c_obs_vol constant text := 'Voltou a aparecer na planilha do TOA.';
  -- 189: o que estava em deslocamento e sumiu vai até Em execução e espera a baixa
  c_obs_sum_exec constant text :=
    'Sumiu da planilha do TOA depois de sair para o endereço: fica em execução até você dar a baixa.';
  v_obs text;
begin
  -- 165: a fila da cidade — só a importação da vez mexe nos contratos.
  perform exigir_vez_importacao(p_importacao_id);
  if not ((eh_gestao() or tem_papel('ROBO')) and tem_permissao('importacao.executar')) then
    raise exception 'Sem permissao para importar.' using errcode = '42501';
  end if;

  select * into v_imp from importacao where id = p_importacao_id;
  if not found or v_imp.base_id not in (select bases_visiveis()) then
    raise exception 'Importacao fora da cidade ativa.' using errcode = '42501';
  end if;
  if v_imp.status <> 'APLICADA' or v_imp.bucket is null then
    return jsonb_build_object('desatribuidos', 0, 'devolvidos', 0,
                              'sumiram', 0, 'voltaram', 0,
                              'motivo', 'importacao nao aplicada ou sem bucket');
  end if;
  v_dia := coalesce(v_imp.data_atuacao, hoje_local());

  select id into v_800 from codigo_baixa
   where codigo = 800 and (empresa_id is null or empresa_id = v_imp.empresa_id)
   order by empresa_id nulls last limit 1;
  if v_800 is null then
    raise exception 'O codigo de baixa 800 (Desatribuido) nao esta cadastrado.';
  end if;

  perform set_config('app.origem', 'IMPORTACAO', true);

  -- 1. VOLTOU: estava desatribuido e apareceu de novo nesta planilha
  for r in
    select v.id, v.situacao from visita v
     where v.desatribuido_em is not null and v.excluido_em is null
       and v.id in (select l.visita_id from importacao_linha l
                     where l.importacao_id = p_importacao_id and l.visita_id is not null)
  loop
    update ordem_servico
       set codigo_baixa_afline_id = null, baixa_em = null, baixa_por = null, baixa_observacao = null
     where visita_id = r.id and codigo_baixa_afline_id = v_800
       and baixa_observacao = c_obs_des;

    if r.situacao = 'CANCELADA' then
      insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
      values (r.id, 'SITUACAO', jsonb_build_object('situacao', 'CANCELADA'),
              jsonb_build_object('situacao', 'ENTRADA'), 'IMPORTACAO', c_obs_dev, p_importacao_id);
      update visita set situacao = 'ENTRADA', situacao_em = now(),
                        desatribuido_em = null, desatribuido_por_importacao = null
       where id = r.id;
    else
      update visita set desatribuido_em = null, desatribuido_por_importacao = null where id = r.id;
    end if;
    n_dev := n_dev + 1;
  end loop;

  -- 1b. 134: estava acusado de ter sumido e voltou a planilha
  for r in
    select v.id from visita v
     where v.sumiu_do_toa_em is not null and v.excluido_em is null
       and v.id in (select l.visita_id from importacao_linha l
                     where l.importacao_id = p_importacao_id and l.visita_id is not null)
  loop
    update visita set sumiu_do_toa_em = null, sumiu_do_toa_importacao = null where id = r.id;
    insert into visita_evento (visita_id, tipo, origem, observacao, importacao_id)
    values (r.id, 'CONFLITO_TOA', 'IMPORTACAO', c_obs_vol, p_importacao_id);
    n_vol := n_vol + 1;
  end loop;

  -- 2. SUMIU: Na entrada, do mesmo bucket, e nao esta nesta planilha
  for r in
    with presentes as materialized (
      select l.visita_id, nullif(btrim(l.dados ->> 'ID da Atividade'), '') as atividade
        from importacao_linha l where l.importacao_id = p_importacao_id
    )
    select v.id from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      cross join lateral (
        select i.bucket from importacao_linha l join importacao i on i.id = l.importacao_id
         where l.visita_id = v.id and i.status = 'APLICADA'
         order by i.criado_em desc limit 1) ult
     where v.base_id = v_imp.base_id
       and v.data_agendada = v_dia
       and v.excluido_em is null
       and v.situacao = 'ENTRADA'
       and v.bloqueado_em is null
       and v.desatribuido_em is null
       and v.toa_atividade_id is not null
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and ult.bucket = v_imp.bucket
       and not exists (select 1 from presentes p where p.visita_id = v.id)
       and not exists (select 1 from presentes p where p.atividade = v.toa_atividade_id)
  loop
    update ordem_servico
       set codigo_baixa_afline_id = v_800, baixa_em = now(), baixa_por = v_eu,
           baixa_observacao = c_obs_des
     where visita_id = r.id and codigo_baixa_afline_id is null;

    insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
    values (r.id, 'SITUACAO', jsonb_build_object('situacao', 'ENTRADA'),
            jsonb_build_object('situacao', 'CANCELADA'), 'IMPORTACAO', c_obs_des, p_importacao_id);
    update visita set situacao = 'CANCELADA', situacao_em = now(),
                      desatribuido_em = now(), desatribuido_por_importacao = p_importacao_id
     where id = r.id;
    n_des := n_des + 1;
  end loop;

  -- 3. 134: EM ANDAMENTO e sumiu -- nao se mexe, acusa
  for r in
    with presentes as materialized (
      select l.visita_id, nullif(btrim(l.dados ->> 'ID da Atividade'), '') as atividade
        from importacao_linha l where l.importacao_id = p_importacao_id
    )
    select v.id, v.equipe_id, v.contrato, v.tecnico_responsavel_id, v.situacao,
           coalesce(ts.nome, ta.nome, 'Contrato') as servico
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
      cross join lateral (
        select i.bucket from importacao_linha l join importacao i on i.id = l.importacao_id
         where l.visita_id = v.id and i.status = 'APLICADA'
         order by i.criado_em desc limit 1) ult
     where v.base_id = v_imp.base_id
       and v.data_agendada = v_dia
       and v.excluido_em is null
       and v.situacao in ('ATRIBUIDA', 'EM_DESLOCAMENTO', 'EM_EXECUCAO', 'COM_IMPEDIMENTO')
       and v.sumiu_do_toa_em is null
       and v.toa_atividade_id is not null
       and coalesce(ta.natureza, '') <> 'JORNADA'
       and ult.bucket = v_imp.bucket
       and not exists (select 1 from presentes p where p.visita_id = v.id)
       and not exists (select 1 from presentes p where p.atividade = v.toa_atividade_id)
  loop
    -- 189: "se teve status o sistema leva o contrato até em execução" (Emanuel,
    -- 03/11). Em deslocamento é movimento; o resto continua só acusado.
    -- A situação muda ANTES de marcar o sumiço (limpar_sumiu_do_toa).
    v_obs := c_obs_sum;
    if r.situacao = 'EM_DESLOCAMENTO' then
      update visita set situacao = 'EM_EXECUCAO', situacao_em = now() where id = r.id;
      v_obs := c_obs_sum_exec;
    end if;

    update visita set sumiu_do_toa_em = now(), sumiu_do_toa_importacao = p_importacao_id
     where id = r.id;

    insert into visita_evento (visita_id, tipo, de, para, origem, observacao, importacao_id)
    values (r.id, 'CONFLITO_TOA',
            case when v_obs = c_obs_sum_exec then jsonb_build_object('situacao', r.situacao) end,
            case when v_obs = c_obs_sum_exec then jsonb_build_object('situacao', 'EM_EXECUCAO') end,
            'IMPORTACAO', v_obs, p_importacao_id);

    if r.equipe_id is not null then
      insert into aviso (empresa_id, equipe_id, visita_id, tipo, titulo, detalhe,
                         contrato, servico, situacao_para)
      values (v_imp.empresa_id, r.equipe_id, r.id, 'SUMIU_TOA',
              'Contrato sumiu da planilha do TOA',
              v_obs, r.contrato, r.servico, r.situacao);
    end if;
    n_sum := n_sum + 1;
  end loop;

  perform set_config('app.origem', '', true);
  return jsonb_build_object('desatribuidos', n_des, 'devolvidos', n_dev,
                            'sumiram', n_sum, 'voltaram', n_vol);
end;
$function$;

notify pgrst, 'reload schema';
