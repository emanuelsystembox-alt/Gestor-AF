-- 265 · Boletim do dia com IA — o plano das 07h e o fechamento das 18h, por cidade (D-380)
--
-- RESPOSTAS DO EMANUEL (13/11), sobre o desenho e a medida abaixo:
--   · a manhã sai às 07h e é REFEITA às 08h (a rota costuma não estar importada às 07h);
--   · a CONCLUSÃO é a do Dashboard INST (D-296): concluídas ÷ encerradas, sem as em aberto, sem
--     cancelado pela central e sem Auditar (`_conclusao_do_dia`) — não concluídos ÷ contratos;
--   · BAIRRO não vai para a IA (fica só node e área).
--   Escrita por um agente em paralelo; revisada e ajustada antes de aplicar.
--
-- > Pedido aprovado pelo Emanuel (12–13/11): às 07h e às 18h (Manaus), um boletim curto escrito
-- > por IA para a gestão de cada cidade. 07h: o plano do dia — o que preocupa hoje. 18h: o
-- > fechamento — TEC1, conclusão, quebras por agrupamento, revisitas, equipes atrasadas, acerto da
-- > previsão e 3 ações para amanhã, comparando com a semana passada quando der.
-- > A IA é o Gemini, no plano grátis. Se a IA falhar, o boletim sai POR REGRA e a tela diz isso.
-- > Para a IA vão só números agregados, códigos de baixa e CÓDIGO de equipe — nunca nome de
-- > técnico (o plano grátis pode treinar com o que recebe), nem dado de cliente, nem contrato.
--
-- O DESENHO — o banco prepara, a VPS só escreve o texto
--   1. O RELÓGIO (pg_cron, pela porta única `rodar_por_cidade`, D-263) chama
--      `preparar_boletim_manha` às 07:00 e `preparar_boletim_noite` às 18:10 de Manaus. Cada uma
--      tira os números (`dados_do_boletim`), escreve o texto POR REGRA
--      (`texto_do_boletim_por_regra`) e grava em `boletim_dia` com `ia_pendente`. A partir daí o
--      boletim EXISTE, com ou sem IA, com ou sem o script da VPS vivo — "o boletim nunca deixa
--      de sair" mora aqui, não num `try` do script.
--   2. O SCRIPT DA VPS (`scripts-vps/boletim/`, cron do host, minutos depois) lê os pendentes
--      (`boletins_pendentes`), manda os `dados` ao Gemini e grava o texto por `gravar_boletim`.
--      Falhou (rede, cota, "high demand", número fora dos dados): fica o da regra, e a tela diz.
--   A chave do Gemini NÃO entra no banco (fica em /opt/supabase/segredos, só root). Por isso a
--   chamada é do host e não do `pg_net` (que existe aqui): pôr a chave no vault a deixaria
--   legível ao `postgres` num banco sem backup e sem cofre de verdade. Recusado.
--
-- O QUE VAI PARA A IA = o que está em `boletim_dia.dados` (auditável, linha a linha)
--   Montado por LISTA BRANCA dentro de `dados_do_boletim`: cada campo é escrito à mão a partir
--   das funções que já existem — nunca o jsonb delas repassado. Elas devolvem nome de técnico
--   (`tecnico`, `nome`, `rotulo`/`detalhe` do fator TECNICO), número de contrato e bairro; nada
--   disso passa. Equipe vai pelo CÓDIGO ("111"). Node e área vão pelo código da rede/operação.
--   Bairro NÃO vai (fora da lista do Emanuel; pergunta em aberto).
--
-- NENHUMA REGRA NOVA — reuso, sem reescrever:
--   previsão e "não cabem" ........ `previsao_do_dia()` (260)
--   acerto da previsão ............ `acerto_da_previsao()` (260)
--   risco de quebra ............... `risco_quebra_do_dia()` (181)
--   risco de revisita ............. `risco_revisita_do_dia(dia)` (261)
--   node em degradação ............ `nodes_em_degradacao(dia)` (262)
--   VT (TEC1, revisita 30 d, evidência, atraso nos marcos) ... `dashboard_visita_tecnica(dia)`
--   fechamento (contratos, TEC1, quebras por agrupamento, revisitas, ritmo) ... `resumo_do_dia(dia)`
--     — a foto das 18h (177). Por isso o da noite é às 18:10: o resumo sai às 18:00 (job 3).
--   As únicas contas daqui são aritmética sobre esses números (TEC1 % = padrão ÷ (padrão + sem),
--   o livro; diferença para a semana passada; concluídos ÷ contratos) e contagens de carga
--   (contratos de hoje por grupo, janela e área, sem jornada).
--
-- O QUE A MEDIDA MOSTROU (13/11, antes de escrever)
--   · ÀS 07h O DIA COSTUMA ESTAR INCOMPLETO. Contratos de hoje já importados às 07:00 contra o
--     total do dia: Manaus 12/11 1 de 335 (primeira importação 07:43), 13/11 61 de 294, 10/11
--     298 de 357; São Luís 12/11 0 de 82, 13/11 51 de 85. A foto das 07:00 de 13/11 previa TEC1
--     100% com 60 contratos; às 07:30, 97,9% com 277. Por isso o boletim da manhã carrega a
--     COBERTURA (quantos contratos, a hora da última importação e o total do mesmo dia da semana
--     passada) — e a hora das 07h é PERGUNTA ao Emanuel (ver o relatório da 265).
--   · `rodar_por_cidade` só roda cidade com contrato no dia: num dia sem nenhuma importação até
--     07:00 (12/11 em São Luís), a cidade fica SEM boletim da manhã.
--
-- POR QUE DEFINER
--   `dados_do_boletim` é a cidade inteira (como o resumo do dia e o risco de quebra): confere
--   `eh_gestao()` e cidade única antes de tudo. A gestão já vê a cidade inteira
--   (`ve_cidade_inteira() = eh_gestao()`), então não há alcance a cortar.
--   `gravar_boletim` e `boletins_pendentes` são do DONO (o script da VPS entra como `postgres`):
--   fechadas a anon, authenticated e service_role. Ninguém grava `boletim_dia` pela API.
--
-- NÃO VERIFICADO
--   · rodar pelo pg_cron de verdade e pelo cron do host (só numa transação desfeita e com o
--     script em /tmp, chamado à mão);
--   · o comportamento do Gemini com cota estourada no plano grátis (só "high demand" foi visto);
--   · o boletim de uma cidade sem VT, sem resumo das 18h ou num domingo.
--
-- ATENÇÃO NA APLICAÇÃO: esta migration RECRIA `rodar_por_cidade` a partir da versão viva de
-- 13/11 (a da 262) com dois nomes a mais na lista. Se a 263 (ou outra) mexer na lista antes,
-- junte as duas — `pg_get_functiondef` no banco, não o arquivo (traps.md).

-- ─────────────────────────────────────────────────────────────── a tabela ──
create table if not exists public.boletim_dia (
  empresa_id    uuid not null references public.empresa(id),
  base_id       uuid not null references public.base(id),
  dia           date not null,
  momento       text not null check (momento in ('MANHA', 'NOITE')),
  texto         text not null,                    -- o que a tela mostra (IA ou regra)
  texto_regra   text not null,                    -- o da regra, sempre (para comparar com o da IA)
  fonte         text not null check (fonte in ('IA', 'REGRA')),
  modelo        text,                             -- o modelo que escreveu (fonte = IA)
  dados         jsonb not null,                   -- EXATAMENTE o que foi (ou iria) para a IA
  gerado_em     timestamptz not null default now(),   -- a hora dos números
  escrito_em    timestamptz not null default now(),   -- a hora do texto atual
  ia_pendente   boolean not null default true,
  ia_tentativas int not null default 0,
  ia_erro       text,                             -- a última recusa/falha da IA (sem chave, sem cabeçalho)
  ia_uso        jsonb,                            -- tokens e milissegundos da chamada
  primary key (base_id, dia, momento)
);
alter table public.boletim_dia enable row level security;

drop policy if exists boletim_dia_leitura on public.boletim_dia;
create policy boletim_dia_leitura on public.boletim_dia for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis())
         and (select eh_gestao()));
-- Ninguém grava pela API: só o relógio (`preparar_boletim_*`) e o dono (`gravar_boletim`).
-- (revoke ALL: na `foto_do_dia` sobrou TRUNCATE/TRIGGER/REFERENCES ao authenticated.)
revoke all on public.boletim_dia from anon, authenticated;
grant select on public.boletim_dia to authenticated;

-- ─────────────────────────────────────────────────────── números em português ──
-- 95.2 → "95,2"; 7.00 → "7"; nulo → "—" (desconhecido não é zero).
create or replace function public._boletim_num(p numeric)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when p is null then '—'
              when p = trunc(p) then trunc(p)::text
              else replace(round(p, 1)::text, '.', ',') end;
$$;
revoke all on function public._boletim_num(numeric) from public, anon;
grant execute on function public._boletim_num(numeric) to authenticated, service_role;  -- o texto por regra é INVOKER

-- ───────────────────────────────────────────── o resumo das 18h, sem nome ──
-- Recebe `resumo_do_dia(...) -> 'operacao'` e devolve só números, agrupamento e código de
-- equipe. Fica de fora: `revisitas.contratos` (contrato e técnico anterior) e
-- `ritmo.abaixo[].nome/tecnico_id/detalhe`.
create or replace function public._boletim_resumo(p_op jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case when p_op is null or jsonb_typeof(p_op) <> 'object' then null else
  jsonb_build_object(
    'contratos', jsonb_build_object(
        'total',       (p_op #>> '{contratos,total}')::int,
        'concluidos',  (p_op #>> '{contratos,concluidos}')::int,
        'reagendados', (p_op #>> '{contratos,reagendados}')::int,
        'cancelados',  (p_op #>> '{contratos,cancelados}')::int,
        'em_aberto',   (p_op #>> '{contratos,em_aberto}')::int,
        'quebrados',   (p_op #>> '{contratos,quebrados}')::int),
    -- TEC1 = com padrão ÷ (com + sem), o livro (D-187)
    'tec1', jsonb_build_object(
        'com_padrao', (p_op #>> '{tec1,padrao}')::int,
        'sem_padrao', (p_op #>> '{tec1,sem_padrao}')::int,
        'meta_pct',   (p_op #>> '{tec1,meta}')::numeric,
        'pct', case when coalesce((p_op #>> '{tec1,padrao}')::int, 0)
                         + coalesce((p_op #>> '{tec1,sem_padrao}')::int, 0) > 0
                    then round(100.0 * (p_op #>> '{tec1,padrao}')::int
                               / ((p_op #>> '{tec1,padrao}')::int + (p_op #>> '{tec1,sem_padrao}')::int), 1) end),
    'quebras_por_agrupamento', coalesce((
        select jsonb_agg(jsonb_build_object('agrupamento', q.x ->> 'agrupamento',
                                            'quebras', (q.x ->> 'quebras')::int)
                         order by (q.x ->> 'quebras')::int desc, q.x ->> 'agrupamento')
          from jsonb_array_elements(coalesce(p_op -> 'quebras', '[]')) q(x)), '[]'),
    'revisitas', (p_op #>> '{revisitas,total}')::int,
    'abaixo_do_ritmo', case when jsonb_typeof(p_op -> 'ritmo') = 'object' then jsonb_build_object(
        'corte_h', (p_op #>> '{ritmo,corte}')::int,
        'tecnicos', jsonb_array_length(coalesce(p_op #> '{ritmo,abaixo}', '[]')),
        'por_frente', (select coalesce(jsonb_object_agg(f.frente, f.n), '{}')
                         from (select coalesce(a.x ->> 'frente', 'SEM FRENTE') as frente, count(*) as n
                                 from jsonb_array_elements(coalesce(p_op #> '{ritmo,abaixo}', '[]')) a(x)
                                group by 1) f),
        'maiores_faltas', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'equipe', m.equipe, 'feitos', m.feitos, 'esperado', m.esperado)
                                 order by m.esperado - m.feitos desc, m.equipe), '[]')
                             from (select coalesce(a.x ->> 'equipe', 'sem equipe') as equipe,
                                          (a.x ->> 'feitos')::numeric as feitos,
                                          (a.x ->> 'esperado')::numeric as esperado
                                     from jsonb_array_elements(coalesce(p_op #> '{ritmo,abaixo}', '[]')) a(x)
                                    order by (a.x ->> 'esperado')::numeric - (a.x ->> 'feitos')::numeric desc,
                                             a.x ->> 'equipe'
                                    limit 6) m)) end,
    'tec1_em_risco', jsonb_build_object(
        'avisados',   (p_op #>> '{tec1_risco,avisados}')::int,
        'sem_padrao', (p_op #>> '{tec1_risco,sem_padrao}')::int,
        'com_padrao', (p_op #>> '{tec1_risco,padrao}')::int))
  end;
$$;
revoke all on function public._boletim_resumo(jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────── os números ──
-- ──────────────────────────────── a conclusão do Dashboard INST (D-296) ──
-- Concluídas ÷ ENCERRADAS (situacoes_terminais), sem as em aberto, sem cancelado pela central e
-- sem Auditar (800 da AFLINE) — a mesma conta de `lib/metricas.ts` (`produtivas`, filtradas por
-- `origemCancelada`) e o mesmo número que a gestão já vê no painel. A foto das 18h
-- (`resumo_do_dia`) conta central e Auditar como cancelados, por isso não serve para isto.
create or replace function public._conclusao_do_dia(p_base uuid, p_dia date)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with v as materialized (
    select v.situacao,
           (v.situacao = 'CANCELADA' and (
              v.cancelado_central_em is not null
              or cancelado_pela_central(v.dados_origem ->> 'Status da Atividade',
                                        v.dados_origem ->> 'Motivo de Fechamento Externo')
              or exists (select 1 from ordem_servico o
                           join codigo_baixa c8 on c8.id = o.codigo_baixa_afline_id
                          where o.visita_id = v.id and c8.codigo = 800))) as fora,
           v.situacao = any (situacoes_terminais()) as encerrada
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.base_id = p_base and v.data_agendada = p_dia and v.excluido_em is null
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  )
  select jsonb_build_object(
    'concluidas', count(*) filter (where not fora and situacao = 'CONCLUIDA'),
    'encerradas', count(*) filter (where not fora and encerrada),
    'em_aberto_fora_da_conta', count(*) filter (where not fora and not encerrada),
    'pct', case when count(*) filter (where not fora and encerrada) > 0
                then round(100.0 * count(*) filter (where not fora and situacao = 'CONCLUIDA')
                           / count(*) filter (where not fora and encerrada), 1) end)
    from v;
$$;
revoke all on function public._conclusao_do_dia(uuid, date) from public, anon, authenticated;

create or replace function public.dados_do_boletim(p_momento text, p_dia date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoje   date := hoje_local();
  v_dia    date := coalesce(p_dia, hoje_local());
  v_emp    uuid := minha_empresa();
  v_base   uuid;
  v_cidade text;
  v_falta  text[] := '{}';     -- as partes que não vieram (o texto diz "indisponível")
  j_prev jsonb; j_rq jsonb; j_nodes jsonb; j_vt jsonb; j_vt7 jsonb; j_rr jsonb; j_ac jsonb;
  j_res jsonb; j_res7 jsonb; j_ontem jsonb;
  c_res jsonb; c_res7 jsonb;
  v_comum jsonb;
  v_out jsonb;
begin
  if not eh_gestao() then
    raise exception 'O boletim do dia é da gestão.' using errcode = '42501';
  end if;
  if p_momento is null or p_momento not in ('MANHA', 'NOITE') then
    raise exception 'Momento do boletim: MANHA ou NOITE.' using errcode = '22023';
  end if;
  select case when count(*) = 1 then min(b::text)::uuid end into v_base from bases_visiveis() b;
  if v_base is null then
    raise exception 'Escolha uma cidade no topo.' using errcode = '22023';
  end if;
  -- A previsão e o risco de quebra só existem para o dia corrente.
  if p_momento = 'MANHA' and v_dia <> v_hoje then
    raise exception 'O boletim da manhã é só de hoje.' using errcode = '22023';
  end if;
  if v_dia > v_hoje or v_dia < v_hoje - 30 then
    raise exception 'Escolha um dia dos últimos 30.' using errcode = '22023';
  end if;
  select b.nome into v_cidade from base b where b.id = v_base;

  -- Cada parte reaproveitada falha sozinha: o boletim sai com o que veio (D-374: "nunca deixa
  -- de sair") e diz o que faltou. O erro vai para o log do Postgres, não para a IA.
  begin j_nodes := nodes_em_degradacao(v_dia);
  exception when others then v_falta := v_falta || 'node_em_degradacao'::text;
    raise warning 'boletim %/%: nodes_em_degradacao: %', v_base, p_momento, sqlerrm; end;
  begin j_vt := dashboard_visita_tecnica(v_dia);
  exception when others then v_falta := v_falta || 'vt'::text;
    raise warning 'boletim %/%: dashboard_visita_tecnica: %', v_base, p_momento, sqlerrm; end;
  if v_dia = v_hoje then
    begin j_prev := previsao_do_dia();
    exception when others then v_falta := v_falta || 'previsao'::text;
      raise warning 'boletim %/%: previsao_do_dia: %', v_base, p_momento, sqlerrm; end;
  end if;

  v_comum := jsonb_build_object(
    'momento', p_momento,
    'cidade', v_cidade,
    'dia', v_dia,
    'dia_semana', (array['segunda-feira','terça-feira','quarta-feira','quinta-feira',
                         'sexta-feira','sábado','domingo'])[extract(isodow from v_dia)::int],
    'numeros_das', to_char(now() at time zone 'America/Manaus', 'HH24:MI'),
    'nodes_em_degradacao', case when j_nodes is null then null else jsonb_build_object(
        'alertas', jsonb_array_length(coalesce(j_nodes -> 'alertas', '[]')),
        'lista', (select coalesce(jsonb_agg(jsonb_build_object(
                     'node', a.x ->> 'node', 'area', a.x ->> 'area', 'regras', a.x -> 'regras',
                     'vt_48h', (a.x ->> 'vt_48h')::int, 'normal_48h', (a.x ->> 'base_48h')::numeric,
                     'infra_claro_72h', (a.x ->> 'infra_72h')::int,
                     'infra_claro_esperado', (a.x ->> 'infra_esperado')::numeric,
                     'sinal_inicial_irregular_48h', (a.x ->> 'irregular_48h')::int,
                     'sinal_lido_48h', (a.x ->> 'lidos_48h')::int,
                     'vt_abertas_hoje', (a.x ->> 'abertos_hoje')::int)), '[]')
                    from (select x from jsonb_array_elements(coalesce(j_nodes -> 'alertas', '[]')) e(x)
                          limit 5) a)) end);

  if p_momento = 'MANHA' then
    begin j_rq := risco_quebra_do_dia();
    exception when others then v_falta := v_falta || 'risco_quebra'::text;
      raise warning 'boletim %/%: risco_quebra_do_dia: %', v_base, p_momento, sqlerrm; end;
    begin j_ontem := resumo_do_dia(v_dia - 1);
    exception when others then v_falta := v_falta || 'resumo_ontem'::text;
      raise warning 'boletim %/%: resumo_do_dia: %', v_base, p_momento, sqlerrm; end;
    begin j_ac := acerto_da_previsao(v_dia - 1, v_dia - 1);
    exception when others then v_falta := v_falta || 'acerto_ontem'::text;
      raise warning 'boletim %/%: acerto_da_previsao: %', v_base, p_momento, sqlerrm; end;
    c_res := _boletim_resumo(j_ontem -> 'operacao');

    with prod as materialized (
      select v.situacao, ts.nome as grupo,
             coalesce(nullif(ar.apelido, ''), ar.codigo, 'sem área') as area,
             case when v.janela_inicio is null then 'sem janela'
                  else to_char(v.janela_inicio, 'HH24"h"') || '–' || to_char(v.janela_fim, 'HH24"h"') end as janela
        from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
        left join tipo_servico ts on ts.id = v.tipo_servico_id
        left join area_trabalho ar on ar.id = v.area_id
       where v.empresa_id = v_emp and v.base_id = v_base and v.excluido_em is null
         and v.data_agendada = v_dia
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
    )
    select v_comum || jsonb_build_object(
      'cobertura', jsonb_build_object(
          'contratos_importados', (select count(*) from prod),
          'ultima_importacao', (select to_char(max(i.criado_em) at time zone 'America/Manaus', 'HH24:MI')
                                  from importacao i
                                 where i.base_id = v_base and i.status = 'APLICADA'
                                   and coalesce(i.data_atuacao, (i.criado_em at time zone 'America/Manaus')::date) = v_dia),
          'total_no_mesmo_dia_da_semana_passada', (
              select count(*) from visita v
                left join tipo_atividade ta on ta.id = v.tipo_atividade_id
               where v.empresa_id = v_emp and v.base_id = v_base and v.excluido_em is null
                 and v.data_agendada = v_dia - 7
                 and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA')),
      'carga', jsonb_build_object(
          'por_grupo', (select coalesce(jsonb_agg(jsonb_build_object('grupo', g.grupo, 'contratos', g.n)
                                                  order by g.n desc, g.grupo), '[]')
                          from (select coalesce(grupo, 'sem grupo') as grupo, count(*) as n from prod group by 1) g),
          'por_janela', (select coalesce(jsonb_agg(jsonb_build_object('janela', j.janela, 'contratos', j.n)
                                                   order by j.janela), '[]')
                           from (select janela, count(*) as n from prod group by 1) j),
          'por_area', (select coalesce(jsonb_agg(jsonb_build_object('area', a.area, 'contratos', a.n)
                                                 order by a.n desc, a.area), '[]')
                         from (select area, count(*) as n from prod group by 1 order by 2 desc, 1 limit 8) a)),
      'vt', case when j_vt is null then null else jsonb_build_object(
          'na_agenda', (j_vt #>> '{equipes_vt,vt}')::int,
          'equipes_de_vt', (j_vt #>> '{equipes_vt,equipes_distintas}')::int,
          'por_equipe', case when (j_vt #>> '{equipes_vt,equipes_distintas}')::int > 0
                             then round((j_vt #>> '{equipes_vt,vt}')::numeric
                                        / (j_vt #>> '{equipes_vt,equipes_distintas}')::int, 1) end,
          'meta_media_por_tecnico', (parametro_valor('vt_meta_media') #>> '{}')::numeric) end,
      'previsao', case when j_prev is null then null else jsonb_build_object(
          'tec1_previsto_pct', (j_prev #>> '{tec1,previsto_pct}')::numeric,
          'meta_pct', (j_prev ->> 'meta')::numeric,
          'os_previstas_sem_padrao', (j_prev #>> '{tec1,prev_sem}')::int,
          'salvar_para_a_meta', (j_prev #>> '{tec1,salvar}')::int,
          'contratos_abertos', (j_prev ->> 'abertos')::int,
          'nao_cabem_na_jornada', (j_prev ->> 'nao_cabem')::int,
          'fim_da_jornada', j_prev ->> 'fim_jornada',
          'fim_previsto_da_operacao', to_char((j_prev ->> 'fim_operacao')::timestamptz at time zone 'America/Manaus', 'HH24:MI'),
          'fim_previsto_passa_da_meia_noite',
              ((j_prev ->> 'fim_operacao')::timestamptz at time zone 'America/Manaus')::date > v_dia,
          'equipes_que_nao_cabem', (select coalesce(jsonb_agg(jsonb_build_object(
                                       'equipe', f.equipe, 'contratos_depois_da_jornada', f.depois)
                                       order by f.depois desc, f.equipe), '[]')
                                      from (select coalesce(x ->> 'equipe', 'sem equipe') as equipe,
                                                   (x ->> 'depois')::int as depois
                                              from jsonb_array_elements(coalesce(j_prev -> 'filas', '[]')) e(x)
                                             where (x ->> 'depois')::int > 0
                                             order by 2 desc, 1 limit 6) f)) end,
      'risco_quebra', case when j_rq is null then null else jsonb_build_object(
          'taxa_da_cidade_pct', (j_rq #>> '{regua,taxa}')::numeric,
          'regua_suficiente', (j_rq #>> '{regua,suficiente}')::boolean,
          'contratos_avaliados', jsonb_array_length(coalesce(j_rq -> 'contratos', '[]')),
          'alto',  (select count(*) from jsonb_array_elements(coalesce(j_rq -> 'contratos', '[]')) e(x) where x ->> 'faixa' = 'ALTO'),
          'medio', (select count(*) from jsonb_array_elements(coalesce(j_rq -> 'contratos', '[]')) e(x) where x ->> 'faixa' = 'MEDIO'),
          'baixo', (select count(*) from jsonb_array_elements(coalesce(j_rq -> 'contratos', '[]')) e(x) where x ->> 'faixa' = 'BAIXO'),
          -- lista BRANCA de famílias: TECNICO e BAIRRO nunca saem daqui
          'fatores', (select coalesce(jsonb_agg(jsonb_build_object(
                          'familia', f.familia, 'valor', f.valor, 'taxa_pct', f.taxa) order by f.razao desc), '[]')
                        from (select x ->> 'familia' as familia, x ->> 'valor' as valor,
                                     (x ->> 'taxa')::numeric as taxa, (x ->> 'razao')::numeric as razao
                                from jsonb_array_elements(coalesce(j_rq #> '{regua,fatores}', '[]')) e(x)
                               where x ->> 'familia' in ('GRUPO', 'JANELA', 'EDIFICACAO', 'SEGMENTACAO',
                                                          'LOG', 'ANTERIOR', 'REVISITA', 'VAI_E_VOLTA')
                               order by (x ->> 'razao')::numeric desc limit 5) f),
          'equipes_com_mais_risco_alto', (select coalesce(jsonb_agg(jsonb_build_object(
                          'equipe', q.equipe, 'contratos_alto', q.n) order by q.n desc, q.equipe), '[]')
                        from (select coalesce(x ->> 'equipe', 'sem equipe') as equipe, count(*) as n
                                from jsonb_array_elements(coalesce(j_rq -> 'contratos', '[]')) e(x)
                               where x ->> 'faixa' = 'ALTO'
                               group by 1 order by 2 desc, 1 limit 5) q)) end,
      'ontem', case when c_res is null and j_ac is null then null else jsonb_build_object(
          'tec1_pct', c_res #> '{tec1,pct}',
          'contratos', c_res #> '{contratos,total}',
          'concluidos', c_res #> '{contratos,concluidos}',
          'quebrados', c_res #> '{contratos,quebrados}',
          'revisitas', c_res -> 'revisitas',
          'previsao_tec1_pct', (select x -> 'previsto_pct' from jsonb_array_elements(coalesce(j_ac -> 'dias', '[]')) e(x) limit 1),
          'previsao_feita_as', (select x ->> 'foto' from jsonb_array_elements(coalesce(j_ac -> 'dias', '[]')) e(x) limit 1),
          'tec1_fechado_pct', (select x -> 'real_pct' from jsonb_array_elements(coalesce(j_ac -> 'dias', '[]')) e(x) limit 1)) end,
      'indisponivel', to_jsonb(v_falta))
      into v_out;

  else  -- NOITE
    begin j_res := resumo_do_dia(v_dia);
    exception when others then v_falta := v_falta || 'resumo'::text;
      raise warning 'boletim %/%: resumo_do_dia: %', v_base, p_momento, sqlerrm; end;
    begin j_res7 := resumo_do_dia(v_dia - 7);
    exception when others then v_falta := v_falta || 'resumo_semana_passada'::text;
      raise warning 'boletim %/%: resumo_do_dia(-7): %', v_base, p_momento, sqlerrm; end;
    begin j_vt7 := dashboard_visita_tecnica(v_dia - 7);
    exception when others then v_falta := v_falta || 'vt_semana_passada'::text;
      raise warning 'boletim %/%: dashboard_visita_tecnica(-7): %', v_base, p_momento, sqlerrm; end;
    begin j_rr := risco_revisita_do_dia(v_dia);
    exception when others then v_falta := v_falta || 'risco_revisita'::text;
      raise warning 'boletim %/%: risco_revisita_do_dia: %', v_base, p_momento, sqlerrm; end;
    begin
      j_ac := case when v_dia = v_hoje then acerto_da_previsao() else acerto_da_previsao(v_dia, v_dia) end;
    exception when others then v_falta := v_falta || 'acerto'::text;
      raise warning 'boletim %/%: acerto_da_previsao: %', v_base, p_momento, sqlerrm; end;
    c_res := _boletim_resumo(j_res -> 'operacao');
    c_res7 := _boletim_resumo(j_res7 -> 'operacao');
    -- a conclusão do painel (D-296), contada agora: às 18h10, a foto das 18h (D-380)
    if c_res is not null then
      c_res := c_res || jsonb_build_object('conclusao', _conclusao_do_dia(v_base, v_dia))
                     || jsonb_build_object('conclusao_pct', _conclusao_do_dia(v_base, v_dia) -> 'pct');
    end if;
    if j_res is null and not ('resumo' = any (v_falta)) then
      v_falta := v_falta || 'resumo'::text;   -- a foto das 18h não foi tirada
    end if;

    v_out := v_comum || jsonb_build_object(
      'fechamento', c_res,
      'foto_das', case when j_res is not null
                       then to_char((j_res ->> 'gerado_em')::timestamptz at time zone 'America/Manaus', 'HH24:MI') end,
      'semana_passada', case when c_res7 is null then null else jsonb_build_object(
          'dia', v_dia - 7,
          'tec1_pct', c_res7 #> '{tec1,pct}',
          'contratos', c_res7 #> '{contratos,total}',
          'quebrados', c_res7 #> '{contratos,quebrados}',
          'revisitas', c_res7 -> 'revisitas',
          'quebras_por_agrupamento', c_res7 -> 'quebras_por_agrupamento',
          'vt_tec1_pct', case when j_vt7 is not null
                                   and coalesce((j_vt7 #>> '{tec1,padrao}')::int, 0) + coalesce((j_vt7 #>> '{tec1,sem_padrao}')::int, 0) > 0
                              then round(100.0 * (j_vt7 #>> '{tec1,padrao}')::int
                                         / ((j_vt7 #>> '{tec1,padrao}')::int + (j_vt7 #>> '{tec1,sem_padrao}')::int), 1) end,
          'vt_revisita_30d_pct', case when j_vt7 is not null and (j_vt7 #>> '{revisita30,base}')::int > 0
                                      then round(100.0 * (j_vt7 #>> '{revisita30,n}')::int / (j_vt7 #>> '{revisita30,base}')::int, 1) end) end,
      'diferenca_para_semana_passada', case when c_res is null or c_res7 is null then null else jsonb_build_object(
          'tec1_pp', (c_res #>> '{tec1,pct}')::numeric - (c_res7 #>> '{tec1,pct}')::numeric,
          'quebrados', (c_res #>> '{contratos,quebrados}')::int - (c_res7 #>> '{contratos,quebrados}')::int,
          'revisitas', (c_res ->> 'revisitas')::int - (c_res7 ->> 'revisitas')::int) end,
      'vt', case when j_vt is null then null else jsonb_build_object(
          'contratos', (j_vt ->> 'volume')::int,
          'tec1', jsonb_build_object(
              'com_padrao', (j_vt #>> '{tec1,padrao}')::int,
              'sem_padrao', (j_vt #>> '{tec1,sem_padrao}')::int,
              'em_aberto', (j_vt #>> '{tec1,em_aberto}')::int,
              'pct', case when coalesce((j_vt #>> '{tec1,padrao}')::int, 0) + coalesce((j_vt #>> '{tec1,sem_padrao}')::int, 0) > 0
                          then round(100.0 * (j_vt #>> '{tec1,padrao}')::int
                                     / ((j_vt #>> '{tec1,padrao}')::int + (j_vt #>> '{tec1,sem_padrao}')::int), 1) end),
          'revisita_30d', jsonb_build_object(
              'revisitas', (j_vt #>> '{revisita30,n}')::int,
              'vt_na_conta', (j_vt #>> '{revisita30,base}')::int,
              'pct', case when (j_vt #>> '{revisita30,base}')::int > 0
                          then round(100.0 * (j_vt #>> '{revisita30,n}')::int / (j_vt #>> '{revisita30,base}')::int, 1) end),
          'evidencia', jsonb_build_object('com', (j_vt #>> '{evidencia,com}')::int,
                                          'sem', (j_vt #>> '{evidencia,sem}')::int),
          'auditar', (j_vt ->> 'auditar')::int,
          'cancelado_pela_central', (j_vt ->> 'cancelado_central')::int,
          'atraso_nos_marcos', jsonb_build_object(
              'equipes_julgadas', (j_vt #>> '{atraso,julgadas}')::int,
              'equipes_atrasadas', (j_vt #>> '{atraso,atrasadas}')::int,
              'maiores_faltas', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'equipe', m.equipe, 'agenda', m.agenda, 'baixados', m.baixados,
                                    'maior_falta', m.falta) order by m.falta desc, m.equipe), '[]')
                                   from (select coalesce(x ->> 'codigo', 'sem equipe') as equipe,
                                                (x ->> 'agenda')::int as agenda, (x ->> 'baixados')::int as baixados,
                                                (x ->> 'maior_falta')::int as falta
                                           from jsonb_array_elements(coalesce(j_vt #> '{atraso,lista}', '[]')) e(x)
                                          where (x ->> 'maior_falta')::int > 0
                                          order by 4 desc, 1 limit 6) m))) end,
      'acerto_da_previsao', case when j_ac is null then null
          when v_dia = v_hoje then (
            select jsonb_build_object(
                     'previsto_pct', p.x -> 'previsto_pct', 'previsto_as', p.x ->> 'hora',
                     'real_pct', r.x -> 'real_pct', 'real_as', r.x ->> 'hora')
              from (select x from jsonb_array_elements(coalesce(j_ac -> 'hoje', '[]')) e(x)
                     where x ->> 'hora' >= '10:00' order by x ->> 'hora' limit 1) p
              cross join (select x from jsonb_array_elements(coalesce(j_ac -> 'hoje', '[]')) e(x)
                           order by x ->> 'hora' desc limit 1) r)
          else (select jsonb_build_object('previsto_pct', x -> 'previsto_pct', 'previsto_as', x ->> 'foto',
                                          'real_pct', x -> 'real_pct', 'real_as', 'fechamento')
                  from jsonb_array_elements(coalesce(j_ac -> 'dias', '[]')) e(x) limit 1) end,
      'risco_revisita', case when j_rr is null then null else jsonb_build_object(
          'servicos_avaliados', jsonb_array_length(coalesce(j_rr -> 'servicos', '[]')),
          'alto',  (select count(*) from jsonb_array_elements(coalesce(j_rr -> 'servicos', '[]')) e(x) where x ->> 'faixa' = 'ALTO'),
          'medio', (select count(*) from jsonb_array_elements(coalesce(j_rr -> 'servicos', '[]')) e(x) where x ->> 'faixa' = 'MEDIO'),
          'taxa_vt_da_cidade_pct', (j_rr #>> '{reguas,VT,taxa}')::numeric,
          'vt_reagendada_ou_cancelada_que_vai_voltar', jsonb_array_length(coalesce(j_rr -> 'vai_voltar', '[]'))) end,
      'ainda_em_aberto', case when j_prev is null then null else jsonb_build_object(
          'contratos_abertos', (j_prev ->> 'abertos')::int,
          'nao_cabem_na_jornada', (j_prev ->> 'nao_cabem')::int,
          'fim_previsto_da_operacao', to_char((j_prev ->> 'fim_operacao')::timestamptz at time zone 'America/Manaus', 'HH24:MI')) end,
      'indisponivel', to_jsonb(v_falta));
  end if;

  return v_out;
end;
$$;
revoke all on function public.dados_do_boletim(text, date) from public, anon;
grant execute on function public.dados_do_boletim(text, date) to authenticated, service_role;

-- ──────────────────────────────────────────────── o texto por regra fixa ──
-- Os mesmos números, sem IA. As "ações" e o "atenção" seguem uma ORDEM FIXA de verificações
-- (pergunta em aberto ao Emanuel: é essa a prioridade?) e só dizem o que o número mostra.
create or replace function public.texto_do_boletim_por_regra(p jsonb)
returns text
language plpgsql
stable
set search_path to 'public'
as $$
declare
  l    text[] := '{}';
  acao text[] := '{}';
  t    text;
  n    jsonb;
  f    jsonb;
  v    jsonb;
  dm   text := to_char((p ->> 'dia')::date, 'DD/MM');
begin
  n := p -> 'nodes_em_degradacao';

  if p ->> 'momento' = 'MANHA' then
    l := l || format('Plano do dia · %s · %s (números das %s)', p ->> 'cidade', dm, p ->> 'numeros_das');

    t := format('Carga: %s contratos importados', p #>> '{cobertura,contratos_importados}');
    if p #>> '{cobertura,ultima_importacao}' is not null then
      t := t || format(' (última importação %s)', p #>> '{cobertura,ultima_importacao}');
    end if;
    t := t || format('; no mesmo dia da semana passada foram %s.',
                     p #>> '{cobertura,total_no_mesmo_dia_da_semana_passada}');
    l := l || t;

    select string_agg(format('%s %s', x ->> 'grupo', x ->> 'contratos'), ' · ') into t
      from jsonb_array_elements(coalesce(p #> '{carga,por_grupo}', '[]')) e(x);
    if t is not null then l := l || ('Por grupo: ' || t || '.'); end if;
    select string_agg(format('%s %s', x ->> 'janela', x ->> 'contratos'), ' · ') into t
      from jsonb_array_elements(coalesce(p #> '{carga,por_janela}', '[]')) e(x);
    if t is not null then l := l || ('Por janela: ' || t || '.'); end if;

    v := p -> 'vt';
    if v is not null and jsonb_typeof(v) = 'object' then
      l := l || format('VT: %s na agenda em %s equipes (%s por equipe; meta %s por técnico).',
                       v ->> 'na_agenda', v ->> 'equipes_de_vt',
                       _boletim_num((v ->> 'por_equipe')::numeric), _boletim_num((v ->> 'meta_media_por_tecnico')::numeric));
    end if;

    v := p -> 'previsao';
    if v is not null and jsonb_typeof(v) = 'object' then
      l := l || format('TEC1 previsto: %s%% (meta %s%%); %s O.S. previstas sem padrão; para a meta, salvar %s.',
                       _boletim_num((v ->> 'tec1_previsto_pct')::numeric), _boletim_num((v ->> 'meta_pct')::numeric),
                       v ->> 'os_previstas_sem_padrao', v ->> 'salvar_para_a_meta');
      if (v ->> 'nao_cabem_na_jornada')::int > 0 then
        select string_agg(format('%s (%s)', x ->> 'equipe', x ->> 'contratos_depois_da_jornada'), ', ') into t
          from jsonb_array_elements(coalesce(v -> 'equipes_que_nao_cabem', '[]')) e(x);
        l := l || format('Não cabem até %s: %s contratos%s.', v ->> 'fim_da_jornada', v ->> 'nao_cabem_na_jornada',
                         coalesce('; equipes ' || t, ''));
      end if;
    else
      l := l || 'Previsão do TEC1 indisponível.'::text;
    end if;

    v := p -> 'risco_quebra';
    if v is not null and jsonb_typeof(v) = 'object' then
      select string_agg(format('%s (%s)', x ->> 'equipe', x ->> 'contratos_alto'), ', ') into t
        from jsonb_array_elements(coalesce(v -> 'equipes_com_mais_risco_alto', '[]')) e(x);
      l := l || format('Risco de quebra: %s alto, %s médio, %s baixo (taxa da cidade %s%%)%s.',
                       v ->> 'alto', v ->> 'medio', v ->> 'baixo', _boletim_num((v ->> 'taxa_da_cidade_pct')::numeric),
                       coalesce('; mais alto nas equipes ' || t, ''));
    end if;

    v := p -> 'ontem';
    if v is not null and jsonb_typeof(v) = 'object' then
      t := format('Ontem: TEC1 %s%%, %s quebrados, %s revisitas',
                  _boletim_num((v ->> 'tec1_pct')::numeric), coalesce(v ->> 'quebrados', '—'), coalesce(v ->> 'revisitas', '—'));
      if v ->> 'previsao_tec1_pct' is not null then
        t := t || format('; a previsão das %s deu %s%% e o dia fechou em %s%%', v ->> 'previsao_feita_as',
                         _boletim_num((v ->> 'previsao_tec1_pct')::numeric), _boletim_num((v ->> 'tec1_fechado_pct')::numeric));
      end if;
      l := l || (t || '.');
    end if;

    -- Atenção (ordem fixa): previsão abaixo da meta · não cabem · node · risco alto
    v := p -> 'previsao';
    if v is not null and jsonb_typeof(v) = 'object'
       and (v ->> 'tec1_previsto_pct')::numeric < (v ->> 'meta_pct')::numeric then
      acao := acao || format('TEC1 previsto abaixo da meta: %s O.S. a salvar.', v ->> 'salvar_para_a_meta');
    end if;
    if v is not null and jsonb_typeof(v) = 'object' and (v ->> 'nao_cabem_na_jornada')::int > 0 then
      acao := acao || format('%s contratos não cabem na jornada: ver a redistribuição.', v ->> 'nao_cabem_na_jornada');
    end if;
    if n is not null and (n ->> 'alertas')::int > 0 then
      acao := acao || format('Node %s em degradação: confirmar com a CLARO antes de mandar outra VT.',
                             n #>> '{lista,0,node}');
    end if;
    v := p -> 'risco_quebra';
    if v is not null and jsonb_typeof(v) = 'object' and (v ->> 'alto')::int > 0 then
      acao := acao || format('%s contratos com risco alto de quebra: conferir na tela Risco de quebra.', v ->> 'alto');
    end if;
    if array_length(acao, 1) > 0 then
      l := l || 'Atenção hoje:'::text;
      for i in 1 .. least(3, array_length(acao, 1)) loop
        l := l || format('%s. %s', i, acao[i]);
      end loop;
    end if;

  else  -- NOITE
    v := p -> 'fechamento';
    l := l || format('Fechamento · %s · %s (foto das %s)', p ->> 'cidade', dm,
                     coalesce(p ->> 'foto_das', p ->> 'numeros_das'));
    if v is null or jsonb_typeof(v) <> 'object' then
      l := l || 'O resumo das 18h não foi gerado: sem contratos, TEC1 e quebras do dia.'::text;
    else
      l := l || format('Contratos: %s · concluídos %s (%s%% das encerradas, como no painel) · reagendados %s · cancelados %s · em aberto %s · quebrados %s.',
                       v #>> '{contratos,total}', v #>> '{contratos,concluidos}', _boletim_num((v ->> 'conclusao_pct')::numeric),
                       v #>> '{contratos,reagendados}', v #>> '{contratos,cancelados}',
                       v #>> '{contratos,em_aberto}', v #>> '{contratos,quebrados}');
      t := format('TEC1: %s%% (%s com padrão, %s sem; meta %s%%)', _boletim_num((v #>> '{tec1,pct}')::numeric),
                  v #>> '{tec1,com_padrao}', v #>> '{tec1,sem_padrao}', _boletim_num((v #>> '{tec1,meta_pct}')::numeric));
      if p #>> '{semana_passada,tec1_pct}' is not null then
        t := t || format('; semana passada %s%% (%s%s p.p.)', _boletim_num((p #>> '{semana_passada,tec1_pct}')::numeric),
                         case when (p #>> '{diferenca_para_semana_passada,tec1_pp}')::numeric >= 0 then '+' else '' end,
                         _boletim_num((p #>> '{diferenca_para_semana_passada,tec1_pp}')::numeric));
      end if;
      l := l || (t || '.');
      select string_agg(format('%s %s', x ->> 'agrupamento', x ->> 'quebras'), ' · ') into t
        from jsonb_array_elements(coalesce(v -> 'quebras_por_agrupamento', '[]')) e(x);
      l := l || ('Quebras por agrupamento: ' || coalesce(t, 'nenhuma') || '.');
      l := l || format('Revisitas: %s%s.', v ->> 'revisitas',
                       case when p #>> '{semana_passada,revisitas}' is not null
                            then format(' (semana passada %s)', p #>> '{semana_passada,revisitas}') else '' end);
      if jsonb_typeof(v -> 'abaixo_do_ritmo') = 'object' and (v #>> '{abaixo_do_ritmo,tecnicos}')::int > 0 then
        select string_agg(format('%s %s', k, x), ', ') into t from jsonb_each_text(v #> '{abaixo_do_ritmo,por_frente}') e(k, x);
        l := l || format('Abaixo do ritmo às %sh: %s técnicos (%s).', v #>> '{abaixo_do_ritmo,corte_h}',
                         v #>> '{abaixo_do_ritmo,tecnicos}', t);
      end if;
    end if;

    f := p -> 'vt';
    if f is not null and jsonb_typeof(f) = 'object' then
      l := l || format('VT: %s contratos; TEC1 %s%%; revisita 30 d %s de %s (%s%%); %s sem evidência.',
                       f ->> 'contratos', _boletim_num((f #>> '{tec1,pct}')::numeric),
                       f #>> '{revisita_30d,revisitas}', f #>> '{revisita_30d,vt_na_conta}',
                       _boletim_num((f #>> '{revisita_30d,pct}')::numeric), f #>> '{evidencia,sem}');
      if (f #>> '{atraso_nos_marcos,equipes_atrasadas}')::int > 0 then
        select string_agg(format('%s (%s)', x ->> 'equipe', x ->> 'maior_falta'), ', ') into t
          from jsonb_array_elements(coalesce(f #> '{atraso_nos_marcos,maiores_faltas}', '[]')) e(x);
        l := l || format('Equipes de VT atrasadas nos marcos: %s de %s%s.',
                         f #>> '{atraso_nos_marcos,equipes_atrasadas}', f #>> '{atraso_nos_marcos,equipes_julgadas}',
                         coalesce('; maior falta: ' || t, ''));
      end if;
    end if;

    f := p -> 'acerto_da_previsao';
    if f is not null and jsonb_typeof(f) = 'object' and f ->> 'previsto_pct' is not null then
      l := l || format('Previsão: às %s previa TEC1 %s%%; real %s%% (%s).', f ->> 'previsto_as',
                       _boletim_num((f ->> 'previsto_pct')::numeric), _boletim_num((f ->> 'real_pct')::numeric), f ->> 'real_as');
    end if;

    f := p -> 'risco_revisita';
    if f is not null and jsonb_typeof(f) = 'object' then
      l := l || format('Risco de revisita: %s serviços avaliados, %s alto, %s médio; VT reagendadas ou canceladas que vão voltar: %s.',
                       f ->> 'servicos_avaliados', f ->> 'alto', f ->> 'medio',
                       f ->> 'vt_reagendada_ou_cancelada_que_vai_voltar');
    end if;

    -- Ações para amanhã (ordem fixa): TEC1 abaixo da meta · maior agrupamento de quebra ·
    -- equipes de VT atrasadas · node · revisitas · em aberto · abaixo do ritmo
    if v is not null and jsonb_typeof(v) = 'object' then
      if (v #>> '{tec1,pct}')::numeric < (v #>> '{tec1,meta_pct}')::numeric then
        acao := acao || format('TEC1 fechou abaixo da meta (%s%% de %s%%): rever as O.S. sem padrão.',
                               _boletim_num((v #>> '{tec1,pct}')::numeric), _boletim_num((v #>> '{tec1,meta_pct}')::numeric));
      end if;
      if jsonb_array_length(coalesce(v -> 'quebras_por_agrupamento', '[]')) > 0 then
        acao := acao || format('Atacar a quebra por %s (%s hoje).',
                               v #>> '{quebras_por_agrupamento,0,agrupamento}', v #>> '{quebras_por_agrupamento,0,quebras}');
      end if;
    end if;
    f := p -> 'vt';
    if f is not null and jsonb_typeof(f) = 'object'
       and jsonb_array_length(coalesce(f #> '{atraso_nos_marcos,maiores_faltas}', '[]')) > 0 then
      select string_agg(x ->> 'equipe', ', ') into t
        from (select x from jsonb_array_elements(f #> '{atraso_nos_marcos,maiores_faltas}') e(x) limit 3) s;
      acao := acao || format('Acompanhar nos marcos da VT as equipes %s.', t);
    end if;
    if n is not null and (n ->> 'alertas')::int > 0 then
      acao := acao || format('Levar o node %s à CLARO antes de mandar outra VT.', n #>> '{lista,0,node}');
    end if;
    if v is not null and jsonb_typeof(v) = 'object' then
      if (v ->> 'revisitas')::int > 0 then
        acao := acao || format('Rever a causa das %s revisitas do dia.', v ->> 'revisitas');
      end if;
      if (v #>> '{contratos,em_aberto}')::int > 0 then
        acao := acao || format('Fechar os %s contratos ainda em aberto.', v #>> '{contratos,em_aberto}');
      end if;
    end if;
    if array_length(acao, 1) > 0 then
      l := l || 'Ações para amanhã:'::text;
      for i in 1 .. least(3, array_length(acao, 1)) loop
        l := l || format('%s. %s', i, acao[i]);
      end loop;
    end if;
  end if;

  if n is not null and (n ->> 'alertas')::int > 0 then
    select string_agg(format('%s (%s; %s VT em 48 h)', x ->> 'node', coalesce(x ->> 'area', 'sem área'), x ->> 'vt_48h'), ', ')
      into t from jsonb_array_elements(coalesce(n -> 'lista', '[]')) e(x);
    l := l || ('Node em degradação: ' || t || '.');
  end if;
  if jsonb_array_length(coalesce(p -> 'indisponivel', '[]')) > 0 then
    select string_agg(x, ', ') into t from jsonb_array_elements_text(p -> 'indisponivel') e(x);
    l := l || ('Indisponível agora: ' || t || '.');
  end if;

  return array_to_string(l, E'\n');
end;
$$;
-- Só formata o jsonb que recebe (não lê tabela): pode ficar aberta à gestão para conferir.
revoke all on function public.texto_do_boletim_por_regra(jsonb) from public, anon;
grant execute on function public.texto_do_boletim_por_regra(jsonb) to authenticated, service_role;

-- ──────────────────────────────────────────────── o relógio prepara ──
create or replace function public._preparar_boletim(p_momento text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base  uuid;
  v_dados jsonb;
  v_regra text;
begin
  -- Só pelo relógio: `rodar_por_cidade` põe a cidade no cabeçalho, e ela é a única visível.
  if current_setting('app.pelo_relogio', true) is distinct from '1' then
    raise exception 'O boletim do dia é preparado pelo relógio.' using errcode = '42501';
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then return; end if;

  v_dados := dados_do_boletim(p_momento);
  v_regra := texto_do_boletim_por_regra(v_dados);

  -- Regerar SUBSTITUI: números novos, texto da regra, e a IA tenta de novo.
  insert into boletim_dia (empresa_id, base_id, dia, momento, texto, texto_regra, fonte, modelo, dados,
                           gerado_em, escrito_em, ia_pendente, ia_tentativas, ia_erro, ia_uso)
  values (minha_empresa(), v_base, hoje_local(), p_momento, v_regra, v_regra, 'REGRA', null, v_dados,
          now(), now(), true, 0, null, null)
  on conflict (base_id, dia, momento) do update
     set texto = excluded.texto, texto_regra = excluded.texto_regra, fonte = 'REGRA', modelo = null,
         dados = excluded.dados, gerado_em = excluded.gerado_em, escrito_em = excluded.escrito_em,
         ia_pendente = true, ia_tentativas = 0, ia_erro = null, ia_uso = null;
end;
$$;
revoke all on function public._preparar_boletim(text) from public, anon, authenticated;

create or replace function public.preparar_boletim_manha()
returns void language sql security definer set search_path to 'public'
as $$ select _preparar_boletim('MANHA'); $$;
create or replace function public.preparar_boletim_noite()
returns void language sql security definer set search_path to 'public'
as $$ select _preparar_boletim('NOITE'); $$;
revoke all on function public.preparar_boletim_manha() from public, anon, authenticated;
revoke all on function public.preparar_boletim_noite() from public, anon, authenticated;

-- ──────────────────────────────────────────────── o script da VPS ──
-- O que falta escrever com IA: hoje e ontem (um 18:10 que virou a noite), até 3 tentativas.
create or replace function public.boletins_pendentes()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'base_id', b.base_id, 'dia', b.dia, 'momento', b.momento,
           'tentativas', b.ia_tentativas, 'dados', b.dados) order by b.dia, b.momento, b.base_id), '[]')
    from boletim_dia b
   where b.ia_pendente and b.ia_tentativas < 3 and b.dia >= hoje_local() - 1;
$$;
revoke all on function public.boletins_pendentes() from public, anon, authenticated, service_role;

-- Texto da IA → fonte IA. Sem texto → conta a tentativa e guarda o porquê (a tela mostra o da
-- regra). Só ATUALIZA: o boletim tem de existir antes (quem cria é o relógio).
create or replace function public.gravar_boletim(
  p_base uuid, p_dia date, p_momento text,
  p_texto text, p_modelo text, p_uso jsonb, p_erro text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if p_texto is not null and length(btrim(p_texto)) > 0 then
    if length(p_texto) > 3000 then
      raise exception 'Texto do boletim longo demais (% caracteres).', length(p_texto) using errcode = '22023';
    end if;
    update boletim_dia
       set texto = btrim(p_texto), fonte = 'IA', modelo = left(p_modelo, 80), ia_uso = p_uso,
           ia_pendente = false, ia_tentativas = ia_tentativas + 1, ia_erro = null, escrito_em = now()
     where base_id = p_base and dia = p_dia and momento = p_momento;
    get diagnostics v_n = row_count;
    return case when v_n = 1 then 'IA' else 'NAO_ACHEI' end;
  end if;

  update boletim_dia
     set ia_tentativas = ia_tentativas + 1, ia_erro = left(coalesce(p_erro, 'sem texto'), 500),
         ia_uso = p_uso, ia_pendente = ia_tentativas + 1 < 3
   where base_id = p_base and dia = p_dia and momento = p_momento;
  get diagnostics v_n = row_count;
  return case when v_n = 1 then 'REGRA' else 'NAO_ACHEI' end;
end;
$$;
revoke all on function public.gravar_boletim(uuid, date, text, text, text, jsonb, text)
  from public, anon, authenticated, service_role;

-- ──────────────────────────────────────────────────────── a tela lê ──
-- INVOKER: a policy decide (gestão, cidade ativa). Quem não é gestão recebe nulo.
create or replace function public.boletim_do_dia(p_dia date default null)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_dia date := coalesce(p_dia, hoje_local());
begin
  if not (select eh_gestao()) then return null; end if;
  return jsonb_build_object(
    'dia', v_dia,
    'manha', (select jsonb_build_object('texto', b.texto, 'fonte', b.fonte, 'modelo', b.modelo,
                       'gerado_em', b.gerado_em, 'escrito_em', b.escrito_em,
                       'ia_pendente', b.ia_pendente, 'ia_erro', b.ia_erro)
                from boletim_dia b where b.dia = v_dia and b.momento = 'MANHA'
               order by b.base_id limit 1),
    'noite', (select jsonb_build_object('texto', b.texto, 'fonte', b.fonte, 'modelo', b.modelo,
                       'gerado_em', b.gerado_em, 'escrito_em', b.escrito_em,
                       'ia_pendente', b.ia_pendente, 'ia_erro', b.ia_erro)
                from boletim_dia b where b.dia = v_dia and b.momento = 'NOITE'
               order by b.base_id limit 1));
end;
$$;
revoke all on function public.boletim_do_dia(date) from public, anon;
grant execute on function public.boletim_do_dia(date) to authenticated, service_role;

-- ─────────────────────────────────────── o relógio: a porta única aprende ──
-- Recriada a partir da versão VIVA de 13/11 (262), com os dois nomes do boletim.
create or replace function public.rodar_por_cidade(p_funcao text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  n integer := 0;
begin
  if p_funcao not in ('sinais_do_dia', 'gerar_resumo_do_dia', 'recalcular_risco_quebra',
                      'tirar_foto_do_dia', 'recalcular_risco_revisita',
                      'registrar_nodes_em_degradacao',
                      'preparar_boletim_manha', 'preparar_boletim_noite') then
    raise exception 'rodar_por_cidade: % não está na lista.', p_funcao;
  end if;

  for r in
    select b.id as base_id, a.usuario_id
      from base b
      cross join lateral (
        select up.usuario_id
          from usuario_papel up
          join perfil p on p.id = up.usuario_id
         where up.papel = 'ADMIN' and p.empresa_id = b.empresa_id and p.ativo
         order by p.criado_em
         limit 1) a
     where b.ativo
       and (exists (select 1 from visita v
                     where v.base_id = b.id and v.data_agendada = hoje_local()
                       and v.excluido_em is null)
            -- 178: bucket em uso (importação nos últimos 7 dias) também conta.
            or (p_funcao = 'sinais_do_dia'
                and exists (select 1 from importacao i
                             where i.base_id = b.id and i.status = 'APLICADA'
                               and i.criado_em >= now() - interval '7 days')))
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.usuario_id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers',
      json_build_object('x-afline-cidade', r.base_id)::text, true);
    perform set_config('app.bases_visiveis', '', true);
    perform set_config('app.pelo_relogio', '1', true);
    begin
      execute format('select %I()', p_funcao);
      n := n + 1;
    exception when others then
      -- Uma cidade com defeito não cala as outras.
      raise warning 'rodar_por_cidade(%), cidade %: %', p_funcao, r.base_id, sqlerrm;
    end;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('app.bases_visiveis', '', true);
  perform set_config('app.pelo_relogio', '', true);
  return n;
end;
$$;
revoke all on function public.rodar_por_cidade(text) from public, anon, authenticated;

-- 07:00 e 18:10 de Manaus = 11:00 e 22:10 UTC. O das 18:10 espera o resumo das 18:00 (job
-- 'gerar_resumo_do_dia', 0 22 * * *) e a foto das 18:00 da caixa-preta.
select cron.unschedule('boletim-manha') where exists (select 1 from cron.job where jobname = 'boletim-manha');
select cron.schedule('boletim-manha', '0 11 * * *',
                     $$select public.rodar_por_cidade('preparar_boletim_manha')$$);
-- D-380: refeita às 08h (12:00 UTC), com a rota já importada — substitui a das 07h
select cron.unschedule('boletim-manha-08h') where exists (select 1 from cron.job where jobname = 'boletim-manha-08h');
select cron.schedule('boletim-manha-08h', '0 12 * * *',
                     $$select public.rodar_por_cidade('preparar_boletim_manha')$$);
select cron.unschedule('boletim-noite') where exists (select 1 from cron.job where jobname = 'boletim-noite');
select cron.schedule('boletim-noite', '10 22 * * *',
                     $$select public.rodar_por_cidade('preparar_boletim_noite')$$);

notify pgrst, 'reload schema';
