-- ============================================================================
-- 090 · A importação vai para o dia de atuação, não para a data da planilha
-- ============================================================================
-- > "quando eu fizer a importação de algum arquivo, mesmo que a data esteja
-- >  diferente, a importação da rota, ele precisa ir para o dia atual, so
-- >  sera importado para o dia anterior quando nos escolhermos a data que
-- >  vamos atuar" — Emanuel, 26/09
--
-- ┌─ o defeito, medido ──────────────────────────────────────────────┐
-- │ Até aqui a visita caía no dia da coluna "Data" da planilha. Em   │
-- │ 26/09 a única importação do dia trazia "Data = 25/09" nas 29     │
-- │ linhas: a rota de HOJE entrou ONTEM, e o painel de hoje abriu    │
-- │ vazio. Nas 20 importações de 10 a 23/09 as duas datas batiam —   │
-- │ por isso o defeito só apareceu agora.                            │
-- └──────────────────────────────────────────────────────────────────┘
--
-- Quem decide o dia é QUEM IMPORTA, não o arquivo. `importacao.data_atuacao`
-- guarda a escolha: a tela manda hoje (em Manaus) e só manda outro dia
-- quando a pessoa escolhe. Sem data (chamada antiga), vale `hoje_local()`
-- — nunca `current_date`, que em Manaus vira o dia às 20h.
--
-- O dia de atuação governa TUDO que antes lia "Data":
--   · `visita.data_agendada`, na criação E na atualização;
--   · a equipe do login NA DATA (`equipe_do_contrato`);
--   · `inicio`/`fim`, que eram "Data + hora". Deixá-los no dia da
--     planilha poria o contrato de hoje com início ontem — e o TEC1
--     (janela de hoje × início de ontem) daria um atraso de 24 h.
--   · o `toa_recurso` aprendido na reconciliação.
--
-- A data da planilha NÃO se perde: continua em `dados_origem`, e o evento
-- `IMPORTADA` registra as duas quando divergem. Visita que JÁ existia e
-- muda de dia ganha um evento `DIA_DE_ATUACAO` — contrato que troca de dia
-- sem registro é o que ninguém consegue explicar depois.
--
-- Recusado: ler "o dia mais frequente da planilha" e perguntar só quando
-- divergisse. Seria o sistema decidindo no lugar de quem opera (D-088).
-- ============================================================================

-- ---------- 1. a escolha fica gravada na importação ----------
-- Nula nas importações antigas: ninguém escolheu nada nelas, e preencher
-- com "hoje" inventaria uma escolha. O default entra DEPOIS do add column
-- justamente para não carimbar o histórico.
alter table importacao add column if not exists data_atuacao date;
alter table importacao alter column data_atuacao set default hoje_local();

comment on column importacao.data_atuacao is
  'Dia em que as visitas desta importacao entram (090). Escolhido por quem '
  'importa; a "Data" da planilha fica em dados_origem. Nula = importacao '
  'anterior a 090.';

-- ---------- 2. "hora da planilha" no dia escolhido ----------
create or replace function j_ts_no_dia(d jsonb, p_dia date, k_hora text)
returns timestamp with time zone
language plpgsql immutable set search_path to 'public' as $fn$
declare hr time := j_hora(d, k_hora, 1);
begin
  if p_dia is null or hr is null then return null; end if;
  return (p_dia + hr) at time zone 'America/Manaus';
exception when others then return null;
end;
$fn$;

revoke all on function j_ts_no_dia(jsonb, date, text) from public, anon;
grant execute on function j_ts_no_dia(jsonb, date, text) to authenticated;

-- ---------- 3. a importação lê o dia da importação ----------
-- Base: a versão VIVA de `importar_toa_interno` (pg_get_functiondef em
-- 26/09), não o arquivo — ver traps.md. Mudou só o que é dia.
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
      where v.base_id = v_base and v.toa_atividade_id = v_atividade;

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
        -- 090: a visita que ja existia muda de dia -- com registro.
        if v_dia_antes is distinct from v_dia then
          insert into visita_evento (visita_id, tipo, de, para, origem,
                                     usuario_id, login, importacao_id,
                                     equipe_id, tecnico_id, observacao)
          values (v_id, 'DIA_DE_ATUACAO',
                  jsonb_build_object('dia', v_dia_antes),
                  jsonb_build_object('dia', v_dia, 'data_planilha', v_dia_planilha),
                  'IMPORTACAO', v_usuario, v_login, p_importacao_id,
                  v_equipe, v_tecnico,
                  'Reimportada com outro dia de atuacao');
        end if;

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

-- ---------- 4. a reconciliação aprende o recurso no mesmo dia ----------
-- Só muda a linha do `dia`: era "Data" da planilha com `current_date` de
-- reserva (UTC -- traps.md). Agora é o dia de atuação da importação.
create or replace function public.reconciliar_importacao(p_importacao_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_base    uuid;
  v_empresa uuid;
  v_dia     date;
  n_recurso int := 0;
  n_tipo    int := 0;
  n_ligado  int := 0;
  n_jornada int := 0;
  n_tec1    int := 0;
begin
  select i.base_id, coalesce(i.data_atuacao, hoje_local())
    into v_base, v_dia
    from importacao i where i.id = p_importacao_id;
  if v_base is null then
    return jsonb_build_object('erro', 'importacao sem base');
  end if;
  select b.empresa_id into v_empresa from base b where b.id = v_base;

  with candidatos as (
    select nullif(btrim(l.dados->>'ID do Recurso'), '')     as recurso,
           nullif(btrim(l.dados->>'Login do Técnico'), '')  as login,
           v_dia                                            as dia
      from importacao_linha l
     where l.importacao_id = p_importacao_id
  ),
  validos as (
    select recurso, login, min(dia) as de, max(dia) as ate, count(*) as qtd
      from candidatos
     where recurso is not null and login is not null
     group by 1, 2
  ),
  vencedor as (
    select distinct on (recurso) recurso, login, de, ate, qtd
      from validos order by recurso, qtd desc, login
  )
  insert into toa_recurso (base_id, recurso_id, login_toa,
                           primeira_vez, ultima_vez, vezes, empresa_id)
  select v_base, x.recurso, x.login, x.de, x.ate, x.qtd, v_empresa
    from vencedor x
  on conflict (base_id, recurso_id) do update
    set login_toa    = excluded.login_toa,
        ultima_vez   = greatest(toa_recurso.ultima_vez, excluded.ultima_vez),
        primeira_vez = least(toa_recurso.primeira_vez, excluded.primeira_vez),
        vezes        = toa_recurso.vezes + excluded.vezes;
  get diagnostics n_recurso = row_count;

  with novos as (
    select distinct btrim(l.dados->>'Tipo de Atividade__2') as nome
      from importacao_linha l
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados->>'Tipo de Atividade__2','')),'') is not null
  )
  insert into tipo_atividade (nome, natureza, ativo, conferir, empresa_id)
  select x.nome, 'PRODUTIVA', true, true, v_empresa
    from novos x
   where not exists (select 1 from tipo_atividade t
                      where norm_txt(t.nome) = norm_txt(x.nome))
  on conflict (nome) do nothing;
  get diagnostics n_tipo = row_count;

  update visita v
     set tipo_atividade_id = t.id
    from tipo_atividade t
   where v.tipo_atividade_id is null
     and v.base_id = v_base
     and v.excluido_em is null
     and nullif(btrim(coalesce(v.dados_origem->>'Tipo de Atividade__2','')),'') is not null
     and norm_txt(t.nome) = norm_txt(v.dados_origem->>'Tipo de Atividade__2');
  get diagnostics n_ligado = row_count;

  update visita v
     set equipe_id = coalesce(v.equipe_id,
                              equipe_do_contrato(v.base_id, x.login, v.data_agendada)),
         tecnico_responsavel_id = coalesce(v.tecnico_responsavel_id, x.tecnico),
         atualizado_em = now()
    from (
      select vi.id,
             login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso') as login,
             (select t.id from tecnico t
               where t.base_id = vi.base_id
                 and norm_txt(t.matricula) =
                     norm_txt(login_do_recurso(vi.base_id,
                                               vi.dados_origem->>'ID do Recurso'))
               limit 1) as tecnico
        from visita vi
       where vi.base_id = v_base
         and vi.excluido_em is null
         and vi.rota_fixada_em is null
         and nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') is null
         and (vi.equipe_id is null or vi.tecnico_responsavel_id is null)
    ) x
   where v.id = x.id
     and x.login is not null;
  get diagnostics n_jornada = row_count;

  -- 082: as visitas que ESTA importacao tocou. `importacao_linha.visita_id`
  -- e o conjunto exato; `visita.importacao_id` so marca quem CRIOU.
  update ordem_servico o set tec1 = tec1_da_os(o.id)
   where o.visita_id in (select l.visita_id from importacao_linha l
                          where l.importacao_id = p_importacao_id
                            and l.visita_id is not null);
  get diagnostics n_tec1 = row_count;

  update visita v set tec1 = tec1_da_visita(v.id)
   where v.id in (select l.visita_id from importacao_linha l
                   where l.importacao_id = p_importacao_id
                     and l.visita_id is not null);

  return jsonb_build_object(
    'recursos_aprendidos', n_recurso,
    'tipos_criados', n_tipo,
    'visitas_ligadas_ao_tipo', n_ligado,
    'jornada_atribuida', n_jornada,
    'tec1_de_os', n_tec1);
end;
$function$;

notify pgrst, 'reload schema';
