-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 250 — Dashboard VT: o card Revisita 30 D e o filtro de supervisor    │
-- │       (D-363, D-364)                                                 │
-- │                                                                      │
-- │ 1. "vamos criar mais um card chamado Revisita 30 D ao lado do log,   │
-- │    lembrando que é VT da VT apenas, não entra outros serviços (...)  │
-- │    quantas revisita tem no dia, dividido pelo total de VT do dia"    │
-- │    — Emanuel, 10/11. E a VT anterior: "Tudo menos Cancelada pela     │
-- │    Central e Auditar" (perguntado: 20 das 32 de hoje tinham a        │
-- │    anterior concluída, 8 reagendada, 4 em outra situação).           │
-- │                                                                      │
-- │    `revisita_30d_vt(visitas)`: para cada VT, a VT ANTERIOR do mesmo  │
-- │    contrato nos 30 dias antes (mesmo dia conta, se criada antes — o  │
-- │    "até 30 dias" da revisita oficial), PULANDO o Auditar (800 na     │
-- │    baixa da AFLINE) e o cancelado pela central (status do TOA OU a   │
-- │    marca do COP, 198/208). Qualquer outra situação conta — inclusive │
-- │    reagendada, em aberto e cancelada por outro motivo. Só devolve    │
-- │    quem TEM anterior. É OUTRA régua, não a revisita oficial          │
-- │    (`revisita_dos_contratos`: anterior concluída, qualquer → VT),    │
-- │    que continua no REV D-10 e no painel de ofensores.                │
-- │                                                                      │
-- │    Card = revisitas ÷ VT da conta (sem Auditar, sem cancelado pela   │
-- │    central — a VT de hoje que é uma dessas não é VT do dia).         │
-- │                                                                      │
-- │ 2. "criar o filtro por supervisor também nessa janela" — Emanuel,    │
-- │    10/11. Igual ao de área e bucket: vários, nada = todos, vai ao    │
-- │    banco. O supervisor é o da D-134. A equipe de VT continua         │
-- │    decidida pelo dia inteiro (`eq_dia`, sem filtro).                 │
-- │    A versão de 4 parâmetros sai (chamada ambígua no PostgREST); o    │
-- │    site no ar chama por nome com até 4 e continua resolvendo.        │
-- └──────────────────────────────────────────────────────────────────────┘

-- 1 ─────────────────────────────────────────────────────────────────────
create or replace function public.revisita_30d_vt(p_visitas uuid[])
 returns table(visita_id uuid, anterior_id uuid, anterior_data date, anterior_situacao text,
               anterior_equipe text, anterior_tecnico text,
               anterior_baixa_codigo integer, anterior_baixa_descricao text, dias integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  select v.id, a.id, a.data_agendada, a.situacao, e.codigo, t.nome, cb.codigo, cb.descricao,
         v.data_agendada - a.data_agendada
    from visita v
    join tipo_servico gv on gv.id = v.tipo_servico_id and gv.nome = 'VISITA TECNICA'
    join lateral (
      select x.* from visita x
        join tipo_servico gx on gx.id = x.tipo_servico_id and gx.nome = 'VISITA TECNICA'
       where x.empresa_id = v.empresa_id and x.contrato = v.contrato
         and x.id <> v.id and x.excluido_em is null
         and (x.data_agendada < v.data_agendada
              or (x.data_agendada = v.data_agendada and x.criado_em < v.criado_em))
         and x.data_agendada >= v.data_agendada - 30
         -- pula o Auditar e o cancelado pela central — e olha a VT antes dela
         and not (x.situacao = 'CANCELADA' and (
               x.cancelado_central_em is not null
               or cancelado_pela_central(x.dados_origem->>'Status da Atividade',
                                         x.dados_origem->>'Motivo de Fechamento Externo')
               or exists (select 1 from ordem_servico o
                            join codigo_baixa c8 on c8.id = o.codigo_baixa_afline_id
                           where o.visita_id = x.id and c8.codigo = 800)))
       order by x.data_agendada desc, x.criado_em desc
       limit 1
    ) a on true
    left join equipe e  on e.id = a.equipe_id
    left join tecnico t on t.id = a.tecnico_responsavel_id
    -- a baixa da OPERADORA na menor sequência; sem ela, a da AFLINE (como na 241)
    left join lateral (
      select coalesce(o.codigo_baixa_id, o.codigo_baixa_afline_id) as id
        from ordem_servico o
       where o.visita_id = a.id
         and (o.codigo_baixa_id is not null or o.codigo_baixa_afline_id is not null)
       order by (o.codigo_baixa_id is null), o.sequencia
       limit 1
    ) ob on true
    left join codigo_baixa cb on cb.id = ob.id
   where v.id = any(p_visitas)
     and v.contrato is not null;
$function$;

revoke all on function public.revisita_30d_vt(uuid[]) from public, anon;
grant execute on function public.revisita_30d_vt(uuid[]) to authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────
drop function if exists public.dashboard_visita_tecnica(date, uuid[], date, text[]);

CREATE OR REPLACE FUNCTION public.dashboard_visita_tecnica(p_dia date DEFAULT NULL::date, p_areas uuid[] DEFAULT NULL::uuid[], p_ate date DEFAULT NULL::date, p_buckets text[] DEFAULT NULL::text[], p_supervisores text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  -- 244: um PERÍODO. p_dia é o início (o nome ficou pelo site publicado); sem p_ate, o dia só.
  v_dia date := coalesce(p_dia, hoje_local());
  v_ate date := greatest(coalesce(p_ate, p_dia, hoje_local()), coalesce(p_dia, hoje_local()));
  v_dias_periodo int := v_ate - v_dia + 1;
  -- os dias do mês do FIM do período (a projeção do AT1)
  v_dias_mes int := extract(day from (date_trunc('month', v_ate) + interval '1 month - 1 day'))::int;
  v_terminais text[] := situacoes_terminais();
  -- 217: o mínimo de contratos no dia para ser equipe de VT. 242: 3 — "vamos considerar
  -- técnico da VT aquele que tiver mínimo 3 (...) para fazer a média" (Emanuel, 10/11)
  v_min_vt int := 3;
  v_out jsonb;
begin
  with vt_dia as materialized (
    select v.id, v.contrato, v.situacao, v.equipe_id, v.area_id, v.tecnico_responsavel_id,
           v.data_agendada as dia,
           -- 246: o bucket do TOA (sem bucket = 'SEM_BUCKET', como na Certidão de Indicadores)
           coalesce(nullif(btrim(v.toa_bucket), ''), 'SEM_BUCKET') as bucket,
           -- 250: o supervisor na ordem da D-134 (173, 238): o declarado no técnico → o
           -- login ligado à equipe → o texto da planilha. Sem nenhum = 'SEM_SUPERVISOR'.
           coalesce(ps.nome, pe.nome, nullif(btrim(e.supervisor_nome), ''), 'SEM_SUPERVISOR') as supervisor,
           -- 217: janela e endereço (a rua é chave só para comparar; ver o cabeçalho)
           v.janela_inicio, v.janela_fim, v.logradouro, v.complemento, v.bairro,
           -- 241: o fim do atendimento, para a lista do TEC1
           v.fim,
           coalesce(nullif(btrim(v.node), ''), nullif(btrim(v.dados_origem->>'Node'), '')) as node,
           case when btrim(coalesce(v.dados_origem->>'Contador de log', '')) ~ '^\d+(\.\d+)?$'
                then trunc(btrim(v.dados_origem->>'Contador de log')::numeric)::int end as log,
           -- Auditar = o desatribuído (800 na baixa da AFLINE), como origemCancelada() na web
           (v.situacao = 'CANCELADA' and exists (
              select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
               where o.visita_id = v.id and cb.codigo = 800)) as auditar,
           (v.situacao = 'CANCELADA'
            and (v.cancelado_central_em is not null
                 or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                           v.dados_origem->>'Motivo de Fechamento Externo'))) as central_bruto,
           -- 216 (D-323): o TOA cancelou pela central, mesmo que o contrato siga Em execução
           -- aqui por ter tido movimento (189, D-278)
           (v.cancelado_central_em is not null
            or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                      v.dados_origem->>'Motivo de Fechamento Externo')) as central_toa
      from visita v
      join tipo_servico g on g.id = v.tipo_servico_id and g.nome = 'VISITA TECNICA'
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join equipe e   on e.id = v.equipe_id
      left join perfil pe  on pe.id = e.supervisor_id
      left join tecnico tc on tc.id = v.tecnico_responsavel_id
      left join perfil ps  on ps.id = tc.supervisor_id
     where v.data_agendada between v_dia and v_ate
       and v.excluido_em is null
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and coalesce(ta.natureza, '') <> 'JORNADA'
  ),
  -- 224 (D-335): o filtro de área. Nulo ou vazio = todas.
  vt as materialized (
    select * from vt_dia
     where (coalesce(cardinality(p_areas), 0) = 0 or area_id = any(p_areas))
       -- 246: o filtro de bucket, do mesmo jeito (nulo ou vazio = todos)
       and (coalesce(cardinality(p_buckets), 0) = 0 or bucket = any(p_buckets))
       -- 250: o filtro de supervisor, do mesmo jeito (nulo ou vazio = todos)
       and (coalesce(cardinality(p_supervisores), 0) = 0 or supervisor = any(p_supervisores))
  ),
  -- 224: a equipe de VT continua decidida pelo DIA INTEIRO (4 ou mais, 217) — filtrar
  -- uma área não tira da conta a equipe que fez 3 aqui e 3 noutra área. Mesmas regras
  -- de "conta" (sem Auditar, sem cancelado pela central).
  eq_dia as materialized (
    select equipe_id, dia, count(*)::int as n_dia from vt_dia
     where not auditar and not central_bruto and equipe_id is not null
     group by equipe_id, dia
  ),
  vt2 as materialized (
    -- a ordem da web: o 800 primeiro, depois o cancelado pela central
    select vt.*, (not vt.auditar and vt.central_bruto) as central from vt
  ),
  conta as materialized (select * from vt2 where not auditar and not central),
  -- 216 (D-323): o AT1 tira também o que o TOA cancelou pela central (inclusive o que
  -- segue Em execução aqui) e qualquer outro Cancelado.
  conta_at1 as materialized (select * from conta where not central_toa and situacao <> 'CANCELADA'),
  -- O código do contrato: as O.S. com baixa do TOA; sem nenhuma, as da AFLINE.
  codos as materialized (
    select c.id as visita_id, o.id as os_id, o.sub_falha_id,
           case when exists (select 1 from ordem_servico x where x.visita_id = c.id and x.codigo_baixa_id is not null)
                then o.codigo_baixa_id else o.codigo_baixa_afline_id end as cb_id,
           case when exists (select 1 from ordem_servico x where x.visita_id = c.id and x.codigo_baixa_id is not null)
                then 'TOA' else 'AFLINE' end as fonte
      from conta c join ordem_servico o on o.visita_id = c.id
  ),
  cod_contrato as materialized (
    select k.visita_id, cb.codigo, cb.descricao, cb.natureza, min(k.fonte) as fonte,
           (array_agg(sf.nome order by sf.nome) filter (where sf.nome is not null))[1] as sub_falha
      from codos k
      join codigo_baixa cb on cb.id = k.cb_id
      left join sub_falha sf on sf.id = k.sub_falha_id
     group by k.visita_id, cb.codigo, cb.descricao, cb.natureza
  ),
  resultado as materialized (
    select c.id, c.equipe_id, c.situacao,
           case when exists (select 1 from cod_contrato k where k.visita_id = c.id and k.natureza = 'IMPRODUTIVA') then 'NAO_EXECUTADO'
                when exists (select 1 from cod_contrato k where k.visita_id = c.id and k.natureza = 'SUCESSO') then 'EXECUTADO'
                when not (c.situacao = any (v_terminais)) then 'EM_ABERTO'
                else 'OUTRO' end as st
      from conta c
  ),
  -- 217: a equipe de VT — 4 ou mais contratos no dia, ou de MANUTENÇÃO com qualquer número.
  eq_vt as materialized (
    -- 244: uma linha por EQUIPE-DIA: no acumulado, a equipe é de VT nos dias em que fez 3+
    select c.equipe_id, c.dia, count(*)::int as n,
           coalesce((select d.n_dia from eq_dia d where d.equipe_id = c.equipe_id and d.dia = c.dia), 0) as n_dia,
           (exists (select 1 from tecnico t
                     where t.equipe_id = c.equipe_id and t.situacao = 'ATIVO'
                       and norm_txt(t.skill) = 'MANUTENCAO')
            or bool_or(exists (select 1 from tecnico t
                                where t.id = c.tecnico_responsavel_id
                                  and norm_txt(t.skill) = 'MANUTENCAO'))) as manut
      from conta c
     where c.equipe_id is not null
     group by c.equipe_id, c.dia
  ),
  jan as materialized (
    select c.id, c.equipe_id, c.dia,
           coalesce((select q.n_dia >= v_min_vt or q.manut from eq_vt q
                      where q.equipe_id = c.equipe_id and q.dia = c.dia), false) as entra,
           case when c.janela_inicio is null or c.janela_fim is null then 'sem janela'
                else regexp_replace(to_char(c.janela_inicio, 'HH24:MI'), ':00$', '') || '–'
                     || regexp_replace(to_char(c.janela_fim, 'HH24:MI'), ':00$', '') end as janela,
           coalesce(c.janela_inicio, time '23:59') as o_ini,
           coalesce(c.janela_fim, time '23:59') as o_fim,
           coalesce(nullif(ar.apelido, ''), ar.codigo, 'sem área') as area
      from conta c
      left join area_trabalho ar on ar.id = c.area_id
  ),
  matriz as materialized (
    select janela, area, grouping(janela) as gj, grouping(area) as ga,
           min(o_ini) as o_ini, min(o_fim) as o_fim,
           count(*)::int as vt,
           count(*) filter (where entra)::int as vt_eq,
           -- 244: equipe-dia (no dia só, é o número de equipes)
           count(distinct equipe_id::text || dia::text) filter (where entra)::int as equipes
      from jan
     group by grouping sets ((janela, area), (janela), (area), ())
  ),
  -- 241: a MESMA chamada de tec1_da_os, agora guardando de qual O.S. é
  tec1 as materialized (
    select c.id as visita_id, o.id as os_id, o.numero_os, o.codigo_baixa_id,
           c.equipe_id, tec1_da_os(o.id) as cl
      from conta c join ordem_servico o on o.visita_id = c.id
  ),
  rev as materialized (
    select r.*, c.contrato
      from revisita_dos_contratos(
             (select coalesce(array_agg(id), '{}') from conta where contrato is not null)) r
      join conta c on c.id = r.visita_id
     where r.revisita
  ),
  -- 250 (D-363): a Revisita 30 D — VT que voltou de VT em até 30 dias (`revisita_30d_vt`)
  rev30 as materialized (
    select r.*, c.contrato, c.dia, c.situacao, c.equipe_id, c.tecnico_responsavel_id
      from revisita_30d_vt(
             (select coalesce(array_agg(id), '{}') from conta where contrato is not null)) r
      join conta c on c.id = r.visita_id
  ),
  -- 244: a certidão de atendimento — a classe é a da 235 (`classe_certidao`)
  cert as materialized (
    select c.id, c.contrato, c.dia, c.equipe_id, c.tecnico_responsavel_id as tec,
           classe_certidao(s.status_os_texto, s.validacao_cor) as cl
      from conta c join sinal_claro s on s.visita_id = c.id
  ),
  areas as materialized (
    select a.id, a.codigo, coalesce(nullif(a.apelido, ''), a.codigo) as rotulo,
           (select b.clientes from base_clientes_area b
             where b.area_id = a.id and b.vigencia_inicio <= v_ate
             order by b.vigencia_inicio desc limit 1) as clientes,
           (select b.vigencia_inicio from base_clientes_area b
             where b.area_id = a.id and b.vigencia_inicio <= v_ate
             order by b.vigencia_inicio desc limit 1) as desde,
           (select count(*) from conta_at1 c where c.area_id = a.id)::int as vt
      from area_trabalho a
     where a.base_id in (select bases_visiveis())
       and (coalesce(cardinality(p_areas), 0) = 0 or a.id = any(p_areas))
       and (a.ativo or exists (select 1 from conta_at1 c where c.area_id = a.id))
  ),
  at1 as (
    select coalesce(sum(vt) filter (where clientes is not null), 0)::int as vt_com_base,
           sum(clientes)::bigint as base,
           (coalesce(sum(vt) filter (where clientes is null), 0)
            + (select count(*) from conta_at1 c where c.area_id is null
                  or c.area_id not in (select id from areas)))::int as vt_sem_base
      from areas
  )
  select jsonb_build_object(
    'dia', v_dia,
    'de', v_dia,
    'ate', v_ate,
    'dias_periodo', v_dias_periodo,
    'dias_mes', v_dias_mes,
    'certidao', jsonb_build_object(
       'finalizados', (select count(*) from cert where cl is not null),
       'regular', (select count(*) from cert where cl = 'REGULAR'),
       'com_falha', (select count(*) from cert where cl = 'COM_FALHA'),
       'sem_validacao', (select count(*) from cert where cl = 'SEM_VALIDACAO'),
       'tecnicos', coalesce((select jsonb_agg(jsonb_build_object(
            'tecnico_id', q.tec, 'tecnico', t.nome, 'equipe', e.codigo,
            'finalizados', q.fin, 'regular', q.reg, 'com_falha', q.cf, 'sem_validacao', q.sv,
            'itens', coalesce(q.itens, '[]'))
            order by q.cf desc, q.sv desc, t.nome nulls last)
          from (select k.tec, count(*)::int as fin,
                       count(*) filter (where k.cl = 'REGULAR')::int as reg,
                       count(*) filter (where k.cl = 'COM_FALHA')::int as cf,
                       count(*) filter (where k.cl = 'SEM_VALIDACAO')::int as sv,
                       jsonb_agg(jsonb_build_object('visita_id', k.id, 'contrato', k.contrato,
                                   'dia', k.dia, 'classe', k.cl, 'equipe', eq.codigo)
                                 order by k.dia, k.contrato) filter (where k.cl <> 'REGULAR') as itens
                  from cert k left join equipe eq on eq.id = k.equipe_id
                 where k.cl is not null
                 group by k.tec) q
          left join tecnico t on t.id = q.tec
          left join equipe e on e.id = t.equipe_id), '[]')),
    -- 224: as áreas para o filtro — as que têm VT no dia (filtradas ou não) e as escolhidas — e o filtro usado
    'areas_opcoes', coalesce((select jsonb_agg(jsonb_build_object(
                      'area_id', a.id, 'rotulo', coalesce(nullif(a.apelido, ''), a.codigo))
                      order by coalesce(nullif(a.apelido, ''), a.codigo))
                    from area_trabalho a
                   where a.base_id in (select bases_visiveis())
                     and (exists (select 1 from vt_dia x where x.area_id = a.id)
                          or a.id = any(coalesce(p_areas, '{}')))), '[]'),
    'areas_filtro', coalesce(to_jsonb(p_areas), '[]'),
    -- 246: os buckets com VT no período (com a contagem) e os escolhidos
    'buckets_opcoes', coalesce((select jsonb_agg(jsonb_build_object('bucket', b, 'n', n) order by b)
                                  from (select x.bucket as b, count(*)::int as n from vt_dia x group by 1
                                        union
                                        select u, 0 from unnest(coalesce(p_buckets, '{}')) u
                                         where u not in (select bucket from vt_dia)) q), '[]'),
    'buckets_filtro', coalesce(to_jsonb(p_buckets), '[]'),
    -- 250: os supervisores com VT no período (com a contagem) e os escolhidos
    'supervisores_opcoes', coalesce((select jsonb_agg(jsonb_build_object('supervisor', s, 'n', n) order by s = 'SEM_SUPERVISOR', s)
                                  from (select x.supervisor as s, count(*)::int as n from vt_dia x group by 1
                                        union
                                        select u, 0 from unnest(coalesce(p_supervisores, '{}')) u
                                         where u not in (select supervisor from vt_dia)) q), '[]'),
    'supervisores_filtro', coalesce(to_jsonb(p_supervisores), '[]'),
    -- 250 (D-363): a Revisita 30 D — sobre as VT da conta (sem Auditar, sem cancelado pela central)
    'revisita30', jsonb_build_object(
       'base', (select count(*) from conta),
       'n', (select count(*) from rev30),
       'lista', coalesce((select jsonb_agg(jsonb_build_object(
            'visita_id', r.visita_id, 'contrato', r.contrato, 'dia', r.dia, 'situacao', r.situacao,
            'equipe', e.codigo, 'tecnico', t.nome,
            'anterior_id', r.anterior_id, 'anterior_data', r.anterior_data,
            'anterior_situacao', r.anterior_situacao, 'dias', r.dias,
            'anterior_equipe', r.anterior_equipe, 'anterior_tecnico', r.anterior_tecnico,
            'anterior_baixa', case when r.anterior_baixa_codigo is null then null
                                   else r.anterior_baixa_codigo || ' - ' || r.anterior_baixa_descricao end)
            order by r.dias, r.contrato)
          from rev30 r
          left join equipe e  on e.id = r.equipe_id
          left join tecnico t on t.id = r.tecnico_responsavel_id), '[]')),
    'total', (select count(*) from vt2),
    'auditar', (select count(*) from vt2 where auditar),
    'cancelado_central', (select count(*) from vt2 where central),
    'volume', (select count(*) from conta),
    'volume_at1', (select count(*) from conta_at1),
    'log', (select jsonb_build_object(
              'base', count(*) filter (where log is not null),
              'sem_log', count(*) filter (where log is null),
              'log3', count(*) filter (where log >= 3),
              'log0', count(*) filter (where log = 0),
              'por_log', coalesce((select jsonb_agg(jsonb_build_object('log', l, 'n', n) order by l)
                                     from (select least(log, 3) l, count(*) n from vt2
                                            where not auditar and log is not null group by 1) q), '[]'))
              from vt2 where not auditar),
    -- 241: os contratos com LOG acima de 1, no universo do card do LOG
    'log_lista', coalesce((select jsonb_agg(jsonb_build_object(
            'visita_id', c.id, 'contrato', c.contrato, 'log', c.log, 'situacao', c.situacao,
            'central', c.central, 'dia', c.dia, 'equipe', e.codigo, 'tecnico', t.nome)
            order by c.log desc, c.contrato)
          from vt2 c
          left join equipe e on e.id = c.equipe_id
          left join tecnico t on t.id = c.tecnico_responsavel_id
         where not c.auditar and c.log >= 2), '[]'),
    'tec1', (select jsonb_build_object(
              'padrao', count(*) filter (where cl = 'PADRAO'),
              'sem_padrao', count(*) filter (where cl = 'SEM_PADRAO'),
              'expurgada', count(*) filter (where cl = 'EXPURGADA'),
              'em_aberto', count(*) filter (where cl is null)) from tec1),
    -- 241: cada O.S. que o card do TEC1 conta, com a classe dela
    'tec1_lista', coalesce((select jsonb_agg(jsonb_build_object(
            'visita_id', k.visita_id, 'os_id', k.os_id, 'contrato', c.contrato, 'dia', c.dia,
            'numero_os', k.numero_os, 'classe', k.cl,
            'janela_inicio', c.janela_inicio, 'janela_fim', c.janela_fim, 'fim', c.fim,
            'situacao', c.situacao, 'equipe_id', c.equipe_id, 'equipe', e.codigo, 'tecnico', t.nome,
            'baixa', case when cb.id is null then null else cb.codigo || ' - ' || cb.descricao end)
            order by case k.cl when 'SEM_PADRAO' then 0 when 'PADRAO' then 1
                               when 'EXPURGADA' then 2 else 3 end,
                     c.janela_fim nulls last, c.contrato, k.numero_os)
          from tec1 k
          join conta c on c.id = k.visita_id
          left join equipe e on e.id = c.equipe_id
          left join tecnico t on t.id = c.tecnico_responsavel_id
          left join codigo_baixa cb on cb.id = k.codigo_baixa_id), '[]'),
    'at1', (select jsonb_build_object('vt_com_base', vt_com_base, 'base', base,
                                      'vt_sem_base', vt_sem_base) from at1),
    'areas', coalesce((select jsonb_agg(jsonb_build_object(
                'area_id', id, 'codigo', codigo, 'rotulo', rotulo, 'clientes', clientes,
                'desde', desde, 'vt', vt) order by rotulo) from areas), '[]'),
    'equipes', coalesce((select jsonb_agg(x order by (x->>'concluidos')::int desc, (x->>'total')::int desc, x->>'rotulo') from (
                select jsonb_build_object(
                  'equipe_id', r.equipe_id, 'codigo', e.codigo, 'nome', e.nome,
                  'executados', count(*) filter (where r.st = 'EXECUTADO'),
                  'nao_executados', count(*) filter (where r.st = 'NAO_EXECUTADO'),
                  'em_aberto', count(*) filter (where r.st = 'EM_ABERTO'),
                  'outros', count(*) filter (where r.st = 'OUTRO'),
                  'total', count(*), 'rotulo', coalesce(e.codigo, ''),
                  -- 242: a SITUAÇÃO do contrato, os status que a operação usa (Emanuel, 10/11).
                  -- Auditar e cancelado pela central já não estão em `conta`.
                  'concluidos', count(*) filter (where r.situacao = 'CONCLUIDA'),
                  'reagendados', count(*) filter (where r.situacao = 'REAGENDAMENTO'),
                  'cancelados', count(*) filter (where r.situacao = 'CANCELADA'),
                  'abertos', count(*) filter (where not (r.situacao = any (v_terminais))),
                  -- 221 (D-329): o técnico embaixo da equipe — o responsável pelos contratos
                  -- do dia; sem ele, o técnico ATIVO cadastrado na equipe
                  'tecnico', coalesce(
                    (select string_agg(distinct t.nome, ' / ') from conta c2
                       join tecnico t on t.id = c2.tecnico_responsavel_id
                      where c2.equipe_id = r.equipe_id),
                    (select string_agg(t.nome, ' / ' order by t.nome) from tecnico t
                      where t.equipe_id = r.equipe_id and t.situacao = 'ATIVO')),
                  -- 217: se ela entra como equipe de VT
                  'equipe_vt', coalesce((select bool_or(q.n_dia >= v_min_vt or q.manut) from eq_vt q
                                          where q.equipe_id = r.equipe_id), false)) as x
                  from resultado r left join equipe e on e.id = r.equipe_id
                 group by r.equipe_id, e.codigo, e.nome) q), '[]'),
    'revisita', jsonb_build_object(
       'total', (select count(*) from rev),
       -- 220 (D-328): uma linha por EQUIPE do serviço anterior, com o técnico embaixo.
       -- O nome é o registrado na visita anterior; sem ele (histórico do ngestor, D-282),
       -- o técnico ATIVO cadastrado na equipe (pelo id — o código 113 existe em duas cidades).
       'tecnicos', coalesce((select jsonb_agg(jsonb_build_object(
            'tecnico', coalesce(q.registrados, q.do_cadastro, ''), 'equipe', q.eq,
            'nome_do_cadastro', q.registrados is null and q.do_cadastro is not null,
            'n', q.n, 'itens', q.itens) order by q.n desc, q.eq) from (
            select g.eq, g.n, g.itens, g.registrados,
                   (select string_agg(t.nome, ' / ' order by t.nome) from tecnico t
                     where t.equipe_id = g.equipe_id and t.situacao = 'ATIVO') as do_cadastro
              from (
                select a.equipe_id, max(rv.anterior_equipe) as eq, count(*) as n,
                       string_agg(distinct rv.anterior_tecnico, ' / ') as registrados,
                       jsonb_agg(jsonb_build_object('visita_id', rv.visita_id, 'contrato', rv.contrato,
                         'anterior_id', rv.anterior_id, 'anterior_data', rv.anterior_data,
                         'anterior_grupo', rv.anterior_grupo, 'dias', rv.dias,
                         'anterior_tecnico', rv.anterior_tecnico,
                         'baixa', case when rv.anterior_baixa_codigo is null then null
                                       else rv.anterior_baixa_codigo || ' - ' || rv.anterior_baixa_descricao end)
                         order by rv.dias) as itens
                  from rev rv
                  left join visita a on a.id = rv.anterior_id
                 group by a.equipe_id) g) q), '[]')),
    'nodes', jsonb_build_object(
       'distintos', (select count(distinct node) from conta),
       'sem_node', (select count(*) from conta where node is null),
       'lista', coalesce((select jsonb_agg(jsonb_build_object(
            'node', node, 'n', n, 'log3', log3, 'nao_executados', nao, 'itens', itens) order by n desc, node) from (
            select c.node, count(*) as n,
                   count(*) filter (where c.log >= 3) as log3,
                   count(*) filter (where r.st = 'NAO_EXECUTADO') as nao,
                   -- 243: janela, situação e código de baixa de cada contrato do node
                   jsonb_agg(jsonb_build_object('visita_id', c.id, 'contrato', c.contrato, 'log', c.log,
                               'situacao', c.situacao,
                               'janela_inicio', c.janela_inicio, 'janela_fim', c.janela_fim,
                               'baixa', (select string_agg(k.codigo || ' - ' || k.descricao, ' · ' order by k.codigo)
                                           from cod_contrato k where k.visita_id = c.id))
                             order by c.log desc nulls last) as itens
              from conta c join resultado r on r.id = c.id
             where c.node is not null
             group by c.node
             order by count(*) desc, c.node
             limit 15) q), '[]')),
    'codigos', jsonb_build_object(
       'contratos_com_baixa', (select count(distinct visita_id) from cod_contrato),
       'sem_baixa', (select count(*) from conta c where not exists (select 1 from cod_contrato k where k.visita_id = c.id)),
       'lista', coalesce((select jsonb_agg(jsonb_build_object(
            'codigo', codigo, 'descricao', descricao, 'natureza', natureza, 'n', n,
            'pelo_afline', afl, 'sub_falhas', sfs, 'itens', itens) order by n desc, codigo) from (
            select k.codigo, k.descricao, k.natureza, count(*) as n,
                   count(*) filter (where k.fonte = 'AFLINE') as afl,
                   (select jsonb_agg(jsonb_build_object('sub_falha', s, 'n', m) order by m desc, s nulls last)
                      from (select k2.sub_falha as s, count(*) as m from cod_contrato k2
                             where k2.codigo = k.codigo group by k2.sub_falha) z) as sfs,
                   jsonb_agg(jsonb_build_object('visita_id', k.visita_id, 'contrato', c.contrato,
                                                'sub_falha', k.sub_falha, 'fonte', k.fonte)
                             order by c.contrato) as itens
              from cod_contrato k join conta c on c.id = k.visita_id
             group by k.codigo, k.descricao, k.natureza) q), '[]')),
    -- 242: a sub-falha ofensora — por contrato, cada sub-falha que alguma O.S. dele tem,
    -- com o código daquela O.S. (o mesmo `codos` do código ofensor).
    'sub_falhas', jsonb_build_object(
       'contratos_com_codigo', (select count(distinct visita_id) from codos where cb_id is not null),
       'sem_sub_falha', (select count(distinct k.visita_id) from codos k
                          where k.cb_id is not null
                            and not exists (select 1 from codos k2 where k2.visita_id = k.visita_id
                                              and k2.sub_falha_id is not null)),
       'lista', coalesce((select jsonb_agg(jsonb_build_object(
            'sub_falha', q.nome, 'n', q.n, 'itens', q.itens) order by q.n desc, q.nome) from (
            select sf.nome, count(distinct k.visita_id) as n,
                   jsonb_agg(distinct jsonb_build_object('visita_id', k.visita_id, 'contrato', c.contrato,
                             'codigo', case when cb.id is null then null
                                            else cb.codigo || ' - ' || cb.descricao end)) as itens
              from codos k
              join sub_falha sf on sf.id = k.sub_falha_id
              join conta c on c.id = k.visita_id
              left join codigo_baixa cb on cb.id = k.cb_id
             group by sf.nome) q), '[]')),
    -- 217: a equipe de VT e a média
    'equipes_vt', jsonb_build_object(
       'minimo', v_min_vt,
       'equipes', (select count(*) from eq_vt where n_dia >= v_min_vt or manut),
       -- 244: quantas equipes diferentes (no período, `equipes` é equipe-dia)
       'equipes_distintas', (select count(distinct equipe_id) from eq_vt where n_dia >= v_min_vt or manut),
       'por_manutencao', (select count(*) from eq_vt where n_dia < v_min_vt and manut),
       'vt', (select coalesce(sum(n), 0) from eq_vt where n_dia >= v_min_vt or manut),
       'sem_equipe', (select count(*) from conta where equipe_id is null),
       -- 244: por equipe, somando os dias em que ela ficou abaixo do mínimo
       'fora', coalesce((select jsonb_agg(jsonb_build_object(
            'equipe_id', f.equipe_id, 'codigo', e.codigo, 'nome', e.nome, 'n', f.n, 'dias', f.dias,
            'itens', (select jsonb_agg(jsonb_build_object('visita_id', c.id, 'contrato', c.contrato, 'dia', c.dia)
                                       order by c.dia, c.contrato)
                        from conta c join eq_vt q2 on q2.equipe_id = c.equipe_id and q2.dia = c.dia
                       where c.equipe_id = f.equipe_id and not (q2.n_dia >= v_min_vt or q2.manut)))
            order by f.n desc, e.codigo)
          from (select q.equipe_id, sum(q.n)::int as n, count(*)::int as dias from eq_vt q
                 where not (q.n_dia >= v_min_vt or q.manut) group by q.equipe_id) f
          left join equipe e on e.id = f.equipe_id), '[]')),
    -- 217: VT por janela × área (gj/ga = 1 marca a linha de total)
    'janelas', coalesce((select jsonb_agg(jsonb_build_object(
            'janela', janela, 'area', area, 'total_janela', ga = 1, 'total_area', gj = 1,
            'vt', vt, 'vt_eq', vt_eq, 'equipes', equipes)
            order by gj, o_ini, o_fim, janela, ga, area) from matriz), '[]'),
    -- 217: LOG, endereço e a chave da rua, por contrato do universo
    -- 241: o universo do LOG (sem Auditar), que contém o de `conta`
    'contratos', coalesce((select jsonb_object_agg(c.id, jsonb_build_object(
            'log', c.log,
            'endereco', nullif(btrim(c.logradouro), ''),
            'complemento', nullif(btrim(c.complemento, ' ,'), ''),
            'bairro', nullif(btrim(c.bairro), ''),
            'rua', case when nullif(btrim(c.logradouro), '') is null then null
                        else norm_txt(split_part(c.logradouro, ',', 1)) || '|' || norm_txt(c.bairro) end))
          from vt2 c where not c.auditar), '{}')
  ) into v_out;

  return v_out;
end $function$;

revoke all on function public.dashboard_visita_tecnica(date, uuid[], date, text[], text[]) from public, anon;
grant execute on function public.dashboard_visita_tecnica(date, uuid[], date, text[], text[]) to authenticated;

notify pgrst, 'reload schema';
