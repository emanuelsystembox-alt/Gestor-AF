-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 184 — Contrato ENCERRADO não reabre pela importação                   │
-- │                                                                      │
-- │ "contratos ja concluídos, estão saindo do concluido e retornando     │
-- │  para execução (...) contratos fechados não devem voltar quando ja   │
-- │  encerrados — como concluido, cancelado, reagendado"                 │
-- │                                                    — Emanuel, 03/11  │
-- │                                                                      │
-- │ O defeito: `situacao_do_toa('concluído')` é EM_EXECUCAO (D-097: o    │
-- │ status diz que a ATIVIDADE fechou, quem diz o resultado é o código). │
-- │ No contrato que o campo baixou, a baixa automática não age (128), e  │
-- │ o caminho do contrato tocado pelo campo gravava o status do TOA por  │
-- │ cima da Concluída, com um CONFLITO_TOA a cada importação. Medido em  │
-- │ 03/11: o 3159369 foi concluído pelo técnico QUATRO vezes (08:33,     │
-- │ 08:43, 09:21, 10:14), reaberto às 08:37, 09:07 e 09:37. Em 7 dias:   │
-- │ 13 Concluídas e 2 Reagendamentos reabertos pela importação.          │
-- │                                                                      │
-- │ A regra agora: encerrado (`situacoes_terminais()`) só muda pelo      │
-- │ CÓDIGO — a baixa automática, quando ela vale para o contrato (128),  │
-- │ e só para outro encerrado (`situacao_da_baixa` nunca devolve aberto).│
-- │ O status do TOA não reabre nada.                                     │
-- │                                                                      │
-- │ Exceção, que é regra do Emanuel e fica: o DESATRIBUÍDO (cód. 800     │
-- │ que o próprio sistema pôs, `desatribuido_em`) volta quando reaparece │
-- │ na planilha (116, D-191). Não é encerramento de ninguém.             │
-- │                                                                      │
-- │ Corrigir um encerrado continua sendo do controlador, pela reversão   │
-- │ com motivo (D-030) — nada disso mudou.                               │
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
  -- 090: o dia de atuação, escolhido por quem importa
  v_dia date; v_dia_antes date; v_dia_planilha date;
  n_criadas int := 0; n_atualiz int := 0; n_ignor int := 0;
  n_erro int := 0; n_conflito int := 0; n_os int := 0; n_susp int := 0;
  resumo jsonb;
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
          mensagem = 'Sem ID da Atividade' where id = r.id;
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

          if v_nova is distinct from v_atual then
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

          if v_nova is distinct from v_atual then
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
$function$

;

-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ Os que a importação reabriu e continuavam abertos em 03/11.          │
-- │ Levantados pelo histórico: último evento de situação = importação    │
-- │ tirando de encerrado, sem Desatribuído. Os 5 têm a baixa da AFLINE   │
-- │ em todas as O.S., com o mesmo destino da situação de antes. Volta a  │
-- │ situação, com evento (o técnico é avisado, como em toda mudança que  │
-- │ não veio do celular — 059). Os "Cancelada → Na entrada" do mesmo     │
-- │ levantamento são Desatribuído que voltou (D-191) e ficam.            │
-- └──────────────────────────────────────────────────────────────────────┘
do $$
declare
  r record;
  n int := 0;
begin
  perform set_config('app.origem', 'IMPORTACAO', true);
  for r in
    select v.id, v.situacao, x.volta
      from visita v
      join (values
        ('fbff6f64-9404-427f-ba83-adcf068eb168'::uuid, 'REAGENDAMENTO'),  -- 1018741
        ('c2a20460-fdd3-4e59-b6da-390a4be1d924'::uuid, 'CONCLUIDA'),      -- 224048132
        ('d63164e0-53fd-42a7-baef-25c4903b2445'::uuid, 'CONCLUIDA'),      -- 2936442
        ('896e486c-b7f5-4444-9a41-13c7e4392b38'::uuid, 'CONCLUIDA'),      -- 8546778
        ('5a94375b-8e8d-4d03-97c7-17716284df07'::uuid, 'CONCLUIDA')       -- 8981806
      ) as x(id, volta) on x.id = v.id
     where not (v.situacao = any(situacoes_terminais()))
  loop
    insert into visita_evento (visita_id, tipo, de, para, origem, observacao)
    values (r.id, 'SITUACAO', jsonb_build_object('situacao', r.situacao),
            jsonb_build_object('situacao', r.volta), 'IMPORTACAO',
            'Correção (184): a importação tinha reaberto um contrato encerrado. Volta ao encerramento do campo.');
    update visita set situacao = r.volta, situacao_em = now() where id = r.id;
    n := n + 1;
  end loop;
  perform set_config('app.origem', '', true);
  raise notice '184: % contrato(s) devolvido(s) ao encerramento', n;
end $$;

notify pgrst, 'reload schema';
