-- 054 · Rota do Dia — a terceira visão
--
-- ┌─ O QUE O EMANUEL PEDIU E AUTORIZOU ──────────────────────────────┐
-- │ "Se eu quisesse olhar a rota como um todo, pra saber se está      │
-- │  ajustada de fato, queria criar uma visão Router."                │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Serviços responde "o que aconteceu neste contrato". Equipes responde
-- "o que a 014 tem hoje". Nenhuma responde **"a rota está ajustada?"**
-- — e o Console de Alocação do TOA também não: ele mostra se o técnico
-- está ocupado, não se faz sentido onde ele está.
--
-- Medido no dia 08/09 ANTES de construir, e foi a medição que
-- justificou a tela: 676 km rodados por 45 técnicos, 38 dos 50 bairros
-- com mais de um técnico, 11 técnicos num bairro só (Alvorada, 19
-- visitas), 50 visitas em que o técnico voltou a um bairro onde já
-- estivera. O caso que resume: Z683677 esteve em Tancredo Neves às
-- 11:37 e voltou às 21:32.
--
-- ⚠ O que estas funções NÃO sabem, e a tela precisa dizer:
--   · o TRAJETO percorrido — o TOA manda pontos, não caminho;
--   · onde o técnico está AGORA — sem GPS ao vivo, isto é o dia que
--     passou e o que está agendado, não rastreamento;
--   · a distância é em LINHA RETA (haversine). Serve para comparar e
--     ordenar; não é quilometragem de combustível.
--
-- Desempenho medido como `authenticated`, não como owner (D-081):
-- rota_do_dia 65 ms, rota_bairros 35 ms, rota_alertas 86 ms.

create or replace function km_entre(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision)
returns double precision language sql immutable parallel safe as $fn$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else 6371 * 2 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lng2 - p_lng1) / 2), 2)))
  end;
$fn$;

revoke all on function km_entre(double precision, double precision,
                                double precision, double precision) from public, anon;
grant execute on function km_entre(double precision, double precision,
                                   double precision, double precision) to authenticated;

-- ============================================================
-- A · O dia de cada técnico, em ordem
-- ============================================================
-- Uma linha por visita, já com a distância desde a anterior DO MESMO
-- técnico e com a marca de "voltou a um bairro onde já esteve hoje" —
-- as duas contas que a tela teria de refazer em JavaScript, e que o
-- banco faz uma vez.
create or replace function rota_do_dia(p_data date)
returns table (
  visita_id uuid, contrato text, login text, tecnico text, equipe text,
  bairro text, area text, lat numeric, lng numeric,
  inicio timestamptz, fim timestamptz,
  janela_inicio time, janela_fim time,
  situacao text, tipo_servico text, ordem int,
  km_desde_anterior double precision, voltou_ao_bairro boolean)
language sql stable security definer set search_path to 'public' as $fn$
  with v as (
    select vi.id, vi.contrato,
           nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') as login,
           nullif(btrim(coalesce(vi.dados_origem->>'Recurso','')),'')          as recurso,
           e.codigo as equipe, vi.bairro, a.apelido as area,
           vi.lat, vi.lng, vi.inicio, vi.fim,
           vi.janela_inicio, vi.janela_fim, vi.situacao, ts.nome as tipo_servico
      from visita vi
      left join equipe e on e.id = vi.equipe_id
      left join area_trabalho a on a.id = vi.area_id
      left join tipo_servico ts on ts.id = vi.tipo_servico_id
      left join tipo_atividade ta on ta.id = vi.tipo_atividade_id
     where vi.excluido_em is null
       and vi.data_agendada = p_data
       and vi.empresa_id = minha_empresa()
       and vi.base_id in (select bases_visiveis())
       and (eh_gestor() or vi.equipe_id in (select equipes_visiveis()))
       -- Jornada não é rota: "Na Base" e "Refeição" não são deslocamento
       -- para cliente (regra do CLAUDE.md).
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  ord as (
    select v.*, row_number() over (partition by v.login
                                   order by v.inicio nulls last, v.id) as ordem
      from v where v.login is not null
  )
  select o.id, o.contrato, o.login, o.recurso, o.equipe, o.bairro, o.area,
         o.lat, o.lng, o.inicio, o.fim, o.janela_inicio, o.janela_fim,
         o.situacao, o.tipo_servico, o.ordem::int,
         km_entre(ant.lat::float8, ant.lng::float8, o.lat::float8, o.lng::float8),
         exists (select 1 from ord x
                  where x.login = o.login and x.ordem < o.ordem - 1
                    and norm_txt(x.bairro) = norm_txt(o.bairro)
                    and o.bairro is not null)
    from ord o
    left join ord ant on ant.login = o.login and ant.ordem = o.ordem - 1
   order by o.login, o.ordem;
$fn$;

revoke all on function rota_do_dia(date) from public, anon;
grant execute on function rota_do_dia(date) to authenticated;

-- ============================================================
-- B · O dia por bairro
-- ============================================================
create or replace function rota_bairros(p_data date)
returns table (bairro text, visitas bigint, tecnicos bigint, equipes bigint,
               concluidas bigint, em_aberto bigint,
               lat numeric, lng numeric)
language sql stable security definer set search_path to 'public' as $fn$
  select r.bairro, count(*), count(distinct r.login), count(distinct r.equipe),
         count(*) filter (where r.situacao = 'CONCLUIDA'),
         count(*) filter (where r.situacao in ('ENTRADA','ATRIBUIDA','EM_DESLOCAMENTO',
                                               'EM_EXECUCAO','COM_IMPEDIMENTO')),
         round(avg(r.lat), 4), round(avg(r.lng), 4)
    from rota_do_dia(p_data) r
   where r.bairro is not null
   group by r.bairro
   order by count(*) desc;
$fn$;

revoke all on function rota_bairros(date) from public, anon;
grant execute on function rota_bairros(date) to authenticated;

-- ============================================================
-- C · O que precisa de olho
-- ============================================================
-- Três achados. Os limites (10 km, 5 técnicos) são o que o dia 08/09
-- mostrou como fora da curva — não são meta da CLARO nem regra da
-- operação, e a tela diz isso: número inventado que parece meta vira
-- cobrança errada.
--
-- `as materialized` porque a CTE é referenciada mais de uma vez e o
-- inline faria `rota_do_dia` rodar de novo a cada braço do UNION
-- (D-081).
create or replace function rota_alertas(p_data date)
returns table (tipo text, gravidade text, login text, tecnico text,
               bairro text, titulo text, detalhe text, valor numeric)
language sql stable security definer set search_path to 'public' as $fn$
  with r as materialized (select * from rota_do_dia(p_data)),
  b as materialized (select * from rota_bairros(p_data))
  select 'RETORNO'::text, 'ALTA'::text, r.login, r.tecnico, r.bairro,
         'Voltou a um bairro onde já esteve hoje'::text,
         format('%s · voltou às %s', r.bairro,
                to_char(r.inicio at time zone 'America/Manaus', 'HH24:MI')),
         null::numeric
    from r where r.voltou_ao_bairro
  union all
  select 'SALTO', case when r.km_desde_anterior >= 15 then 'ALTA' else 'MEDIA' end,
         r.login, r.tecnico, r.bairro,
         'Salto longo até a visita seguinte',
         format('%s km até %s, às %s', round(r.km_desde_anterior::numeric, 1),
                coalesce(r.bairro, 'sem bairro'),
                to_char(r.inicio at time zone 'America/Manaus', 'HH24:MI')),
         round(r.km_desde_anterior::numeric, 1)
    from r where r.km_desde_anterior >= 10
  union all
  select 'PULVERIZADO', case when b.tecnicos >= 8 then 'ALTA' else 'MEDIA' end,
         null, null, b.bairro,
         'Bairro dividido entre muitos técnicos',
         format('%s visitas entre %s técnicos', b.visitas, b.tecnicos),
         b.tecnicos::numeric
    from b where b.tecnicos >= 5
   order by 2, 8 desc nulls last;
$fn$;

revoke all on function rota_alertas(date) from public, anon;
grant execute on function rota_alertas(date) to authenticated;

-- ============================================================
-- D · O resumo do dia
-- ============================================================
create or replace function rota_resumo(p_data date)
returns jsonb language sql stable security definer set search_path to 'public' as $fn$
  with r as materialized (select * from rota_do_dia(p_data))
  select jsonb_build_object(
    'visitas',        (select count(*) from r),
    'tecnicos',       (select count(distinct login) from r),
    'bairros',        (select count(distinct bairro) from r where bairro is not null),
    'km_total',       (select round(sum(km_desde_anterior)::numeric, 1) from r),
    'km_medio',       (select round(avg(km_desde_anterior)::numeric, 1) from r),
    'maior_salto',    (select round(max(km_desde_anterior)::numeric, 1) from r),
    'com_coordenada', (select count(*) from r where lat is not null),
    'retornos',       (select count(*) from r where voltou_ao_bairro),
    'bairros_pulverizados',
      (select count(*) from rota_bairros(p_data) where tecnicos >= 5));
$fn$;

revoke all on function rota_resumo(date) from public, anon;
grant execute on function rota_resumo(date) to authenticated;

notify pgrst, 'reload schema';
