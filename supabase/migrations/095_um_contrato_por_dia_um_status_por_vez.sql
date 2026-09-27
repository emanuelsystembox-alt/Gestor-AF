-- ============================================================================
-- 095 · Um contrato por dia, um status ativo por técnico, e sinais que se limpam
-- ============================================================================
-- Três pedidos do Emanuel (27/09), depois do primeiro dia de teste no celular.
--
-- ┌─ 1. a atividade do TOA é única POR DIA ───────────────────────────┐
-- │ > "se eu importar um arquivo do dia 21, na data do dia 21, e por  │
-- │ >  acidente importar ele na data de hoje dia 27 sem querer, o     │
-- │ >  sistema não deve puxar o histórico de movimentações anterior,  │
-- │ >  ele deve gerar contratos novos para aquele dia, porém a mesma  │
-- │ >  rota se repete"                                                │
-- │ A chave era (base, atividade) — e a 090 MUDAVA o contrato de dia, │
-- │ levando baixa, foto e histórico junto. Agora é (base, atividade,  │
-- │ dia): importar em outro dia cria contratos novos nesse dia; o do  │
-- │ dia original fica intacto. Reimportar no MESMO dia continua       │
-- │ atualizando. O evento DIA_DE_ATUACAO deixa de existir daqui em    │
-- │ diante (os antigos ficam no histórico).                           │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ 2. um status ativo por técnico ──────────────────────────────────┐
-- │ > "não permita que a linha do técnico tenha dois status de        │
-- │ >  contratos diferentes, já que ele não pode estar em dois lugares│
-- │ >  ao mesmo tempo […] só deixe isso acontecer se estiver na       │
-- │ >  planilha de importação […] nem pelo controlador, nem por       │
-- │ >  ninguém"                                                        │
-- │ Gatilho em `visita` — a única porta que TODAS as outras usam      │
-- │ (app, web, baixa, reversão). "Ativo" = Em deslocamento ou Em      │
-- │ execução, no mesmo dia, do mesmo técnico. Ficam FORA da conta:     │
-- │   · a importação (`app.origem = IMPORTACAO`), como ele pediu;     │
-- │   · jornada (Na Base, Refeição) — não é lugar de serviço;         │
-- │   · atividade que o TOA já FECHOU (`finalizado_toa`): ela fica    │
-- │     "Em execução" só esperando a baixa (D-097). Medido em 27/09:  │
-- │     sem essas duas exclusões, 20 pares técnico×dia "violavam" a   │
-- │     regra; com elas, ZERO — a trava nasce sem travar ninguém.     │
-- │ Técnico sem responsável no contrato: conta pela equipe.           │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ 3. sinais: limpa, volta se acontecer de novo, e tem histórico ───┐
-- │ > "as notificações precisam ser dinâmicas, o usuário pode limpar, │
-- │ >  e caso aconteça de novo a situação, ele retorna […] não pode é │
-- │ >  ficar subindo a mesma sempre, ele também pode ir para o        │
-- │ >  histórico de notificações"                                      │
-- │ Cada coisa que a central acusa vira um SINAL com uma chave que diz│
-- │ o que é "a mesma coisa": o mesmo TEC1 perdido (por visita), o     │
-- │ mesmo pedido de suporte (visita + hora do pedido), o mesmo corte  │
-- │ de ritmo (técnico + dia + corte), o mesmo "quebrou" (técnico +    │
-- │ dia + quantas). Limpar é por usuário. Uma perda NOVA tem chave     │
-- │ nova e sobe de novo; a mesma não volta. O histórico é o dia        │
-- │ inteiro, limpos inclusive.                                         │
-- └───────────────────────────────────────────────────────────────────┘
-- ============================================================================

-- ---------- 1. a chave por dia ----------
drop index if exists visita_toa_uk;
create unique index if not exists visita_toa_dia_uk
  on visita (base_id, toa_atividade_id, data_agendada)
  where toa_atividade_id is not null;

-- A importação: a versão da 090 com a busca pelo dia (e sem o "mudar de dia").
create or replace function public.importar_toa_interno(p_importacao_id uuid, p_simular boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record; d jsonb;
  v_base uuid; v_id uuid; v_atividade text; v_bloqueada boolean;
  v_tecnico uuid; v_equipe uuid; v_atual text; v_data date;
  v_usuario uuid; v_arquivo text; v_login text; v_nova text;
  j int; v_num_os text; v_cod integer;
  v_baixa_auto boolean := false; v_sit_baixa text; v_sit_agora text;
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
      select v.id, v.bloqueado_em is not null, v.situacao, v.data_agendada
        into v_id, v_bloqueada, v_atual, v_dia_antes
      from visita v
      -- 095: a atividade do TOA é única POR DIA. O mesmo arquivo importado
      -- em outro dia gera contratos NOVOS nesse dia, sem puxar o histórico.
      where v.base_id = v_base and v.toa_atividade_id = v_atividade
        and v.data_agendada = v_dia;

      v_nova := situacao_do_toa(j_txt(d, 'Status da Atividade'));

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
                                  then now() else situacao_em end
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
      if v_baixa_auto and not coalesce(v_bloqueada, false) then
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
$function$;

-- ---------- 2. um status ativo por técnico ----------
create or replace function um_status_ativo_por_tecnico()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_outro record;
begin
  if new.situacao not in ('EM_DESLOCAMENTO', 'EM_EXECUCAO') then return new; end if;
  if tg_op = 'UPDATE' and old.situacao is not distinct from new.situacao then return new; end if;
  -- A planilha pode trazer dois ao mesmo tempo, e é a única que pode.
  if coalesce(current_setting('app.origem', true), '') = 'IMPORTACAO' then return new; end if;
  if new.excluido_em is not null or coalesce(new.finalizado_toa, false) then return new; end if;
  if exists (select 1 from tipo_atividade ta
              where ta.id = new.tipo_atividade_id and ta.natureza = 'JORNADA') then
    return new;
  end if;
  if new.tecnico_responsavel_id is null and new.equipe_id is null then return new; end if;

  select v.contrato, v.situacao into v_outro
    from visita v
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.id <> new.id and v.excluido_em is null
     and v.data_agendada = new.data_agendada
     and v.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
     and not coalesce(v.finalizado_toa, false)
     and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
     and (case when new.tecnico_responsavel_id is not null
               then v.tecnico_responsavel_id = new.tecnico_responsavel_id
               else v.tecnico_responsavel_id is null and v.equipe_id = new.equipe_id end)
   limit 1;
  if found then
    raise exception 'O tecnico ja esta % no contrato %. Um status por vez: encerre ou mude aquele antes.',
      case v_outro.situacao when 'EM_DESLOCAMENTO' then 'em deslocamento' else 'em execucao' end,
      coalesce(v_outro.contrato, '(sem numero)')
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;
revoke all on function um_status_ativo_por_tecnico() from public, anon;

drop trigger if exists trg_visita_um_status_ativo on visita;
create trigger trg_visita_um_status_ativo
  before insert or update of situacao on visita
  for each row execute function um_status_ativo_por_tecnico();

-- ---------- 3. sinais ----------
create table if not exists sinal (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references empresa(id),
  chave       text not null,
  dia         date not null,
  tipo        text not null check (tipo in ('AJUDA','TEC1','RITMO','QUEBROU','MATERIAL','ABASTECIMENTO')),
  titulo      text not null,
  detalhe     text,
  visita_id   uuid,
  tecnico_id  uuid,
  equipe_id   uuid,
  criado_em   timestamptz not null default now(),
  unique (empresa_id, chave)
);
create index if not exists sinal_dia_idx on sinal (empresa_id, dia);
create table if not exists sinal_dispensa (
  sinal_id      bigint not null references sinal(id) on delete cascade,
  usuario_id    uuid not null,
  dispensado_em timestamptz not null default now(),
  primary key (sinal_id, usuario_id)
);
-- Só pelas funções: RLS ligado e nenhuma policy.
alter table sinal enable row level security;
alter table sinal_dispensa enable row level security;

-- Registra o que a central acusa AGORA (o que já existia não duplica) e
-- devolve a central + os sinais do dia que quem pergunta enxerga.
create or replace function sinais_do_dia()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $fn$
declare
  v_c jsonb := central_do_controle();
  v_hoje date := hoje_local();
  v_emp uuid := minha_empresa();
  v_gestao boolean := eh_gestao();
  v_vigentes text[] := '{}';
  v_sinais jsonb;
begin
  if v_gestao then
    -- Suporte técnico = Impedimento pelo campo. Pedido novo (outra hora)
    -- é sinal novo.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde'), v_hoje, 'AJUDA',
           'Suporte técnico: ' || coalesce(x->>'tecnico', 'técnico'),
           concat_ws(' · ', x->>'servico',
                     case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
                     x->>'observacao'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x
      join visita v on v.id = (x->>'visita_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde')
                                        from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x);

    -- TEC1 perdido: por VISITA. Uma perda nova sobe; a mesma não volta.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'TEC1:' || v.id, v_hoje, 'TEC1', 'TEC1 perdido: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO'
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'TEC1:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO');

    -- Ritmo: técnico + dia + corte.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (c->>'corte'), v_hoje, 'RITMO',
           'Abaixo do ritmo até ' || (c->>'corte') || 'h: ' || (a->>'nome'),
           (a->>'pontos') || ' de ' || (a->>'esperado') || ' pts esperados',
           (a->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ritmo', '[]')) c
      cross join jsonb_array_elements(c->'abaixo') a
      left join tecnico t on t.id = (a->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (c->>'corte')
        from jsonb_array_elements(coalesce(v_c->'ritmo', '[]')) c
        cross join jsonb_array_elements(c->'abaixo') a);

    -- Quebrou: técnico + dia + quantas. Quebrou mais uma = sinal novo.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas'), v_hoje, 'QUEBROU',
           'Contrato quebrado: ' || (q->>'nome'),
           (q->>'quebradas') || ' quebrado(s) hoje · −' || (q->>'pontos_perdidos') || ' pts',
           (q->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q
      left join tecnico t on t.id = (q->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas')
        from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q);
  end if;

  if v_c ? 'material' then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe)
    select v_emp, 'MATERIAL:' || (m->>'id'), v_hoje, 'MATERIAL',
           case m->>'tipo' when 'FALTANDO' then 'Faltando: ' else 'Com defeito: ' end || coalesce(m->>'item', '—'),
           m->>'tecnico'
      from jsonb_array_elements(v_c->'material') m
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'MATERIAL:' || (m->>'id') from jsonb_array_elements(v_c->'material') m);
  end if;

  if v_c ? 'abastecimento' then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe)
    select v_emp, 'ABAST:' || (a->>'id'), v_hoje, 'ABASTECIMENTO',
           'Abastecimento pedido: ' || (a->>'placa'),
           concat_ws(' · ', a->>'tecnico', 'R$ ' || (a->>'valor'))
      from jsonb_array_elements(v_c->'abastecimento') a
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'ABAST:' || (a->>'id') from jsonb_array_elements(v_c->'abastecimento') a);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tipo', s.tipo, 'titulo', s.titulo, 'detalhe', s.detalhe,
           'visita_id', s.visita_id, 'tecnico_id', s.tecnico_id, 'criado_em', s.criado_em,
           'vigente', s.chave = any(v_vigentes),
           'dispensado', d.sinal_id is not null) order by s.criado_em desc), '[]'::jsonb)
    into v_sinais
    from sinal s
    left join sinal_dispensa d on d.sinal_id = s.id and d.usuario_id = auth.uid()
   where s.empresa_id = v_emp and s.dia = v_hoje
     and case
           when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU')
             then v_gestao and (eh_gestor() or s.equipe_id in (select equipes_visiveis()))
           when s.tipo = 'MATERIAL' then tem_permissao('almoxarifado.ver')
           when s.tipo = 'ABASTECIMENTO' then tem_permissao('frota.ver')
           else false
         end;

  return jsonb_build_object('central', v_c, 'sinais', v_sinais);
end;
$fn$;
revoke all on function sinais_do_dia() from public, anon;
grant execute on function sinais_do_dia() to authenticated;

-- Limpar é por usuário: o outro controlador continua vendo.
create or replace function dispensar_sinais(p_ids bigint[])
returns int language plpgsql security definer set search_path to 'public' as $fn$
declare n int;
begin
  insert into sinal_dispensa (sinal_id, usuario_id)
  select s.id, auth.uid() from sinal s
   where s.id = any(p_ids) and s.empresa_id = minha_empresa()
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$fn$;
revoke all on function dispensar_sinais(bigint[]) from public, anon;
grant execute on function dispensar_sinais(bigint[]) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 095b · a trava conta quem foi TOCADO (aplicada em separado, depois do teste)
-- ============================================================================
-- O teste pegou: a trava ignorava TODA atividade que o TOA fechou
-- (`finalizado_toa`), e o 1086530 — que o TOA concluiu e o campo pôs de
-- volta em deslocamento — deixava a gestão pôr outro contrato em execução.
-- Fica fora da conta só o que o TOA fechou E ninguém tocou depois
-- (`bloqueado_em` nulo: `marca_bloqueio` carimba toda mudança de situação
-- fora da importação). A linha que está mudando nunca é excluída por
-- `finalizado_toa`: se muda fora da importação, alguém mexeu.
--
-- Com esse critério, em 27/09 havia UM conflito real já existente (GABRIEL:
-- 1150297 em deslocamento + 1039558 em execução). A trava não corrige o
-- passado; barra a próxima mudança. Testado (desfeito): gestão, reversão e
-- campo recusados (23514); impedimento permitido; saindo do primeiro, o
-- segundo entra.
-- A versão final da função está no banco (`095b_a_trava_conta_quem_foi_tocado`).

-- ============================================================================
-- 095c · o ritmo vigente é o último corte (aplicada em separado)
-- ============================================================================
-- Visto na tela: o sino listava o mesmo técnico abaixo do ritmo às 12h E às
-- 15h (7 itens para 3 técnicos). Vigente passa a ser só o corte MAIS RECENTE;
-- os anteriores continuam registrados e ficam no histórico do dia.
-- Aplicada com replace sobre a versão viva de `sinais_do_dia` (o trecho do
-- ritmo em `v_vigentes`), recusando se o trecho não fosse achado.
