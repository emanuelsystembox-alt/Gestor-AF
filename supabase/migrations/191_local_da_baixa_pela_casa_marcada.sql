-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 191 — Onde o técnico estava na baixa: primeiro onde ELE marcou a casa │
-- │                                                                      │
-- │ "eu quero é pegar a localização mais assertiva do técnico no momento │
-- │  da baixa (...) temos que pegar a mais correta que é onde o técnico  │
-- │  diz que é a casa do cliente, se ele não responder, aí sim pegamos   │
-- │  do gps dele normalmente" — Emanuel, 03/11.                          │
-- │                                                                      │
-- │ A posição do técnico na baixa sai, nesta ordem:                      │
-- │   1. CASA   — a marca "Você está na casa do cliente?" (156e) feita   │
-- │               NESTA visita: GPS fresco, na porta, nunca simulado;    │
-- │   2. APP    — o registro do campo com GPS (baixa ou encerramento),   │
-- │               o mais longe do endereço (D-170);                      │
-- │   3. RASTRO — baixa dada no TOA: o ponto do rastro mais perto do     │
-- │               cliente durante a execução (135/155h).                 │
-- │                                                                      │
-- │ A CASA do cliente (a referência da distância) continua sendo a       │
-- │ coordenada da planilha do TOA. Medido em 03/11, 60 casas marcadas:   │
-- │ mediana de 92 m até ela (38 dentro de 200 m), contra 964 m até a da  │
-- │ varredura (`toa_geo_lat/lng`). A marca é do técnico; a referência,   │
-- │ da operadora — senão quem marca a casa na hora da baixa estaria      │
-- │ sempre "no raio" por construção.                                     │
-- │                                                                      │
-- │ `casa_cliente` não tem policy (só se lê por função) e `local_da_     │
-- │ baixa` é INVOKER: a marca da visita vem de `casa_marcada_na_visita`, │
-- │ DEFINER, com o mesmo escopo de `casa_do_cliente`.                    │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.casa_marcada_na_visita(p_visitas uuid[])
returns table (visita_id uuid, lat double precision, lng double precision,
               precisao_m numeric, marcado_em timestamptz, marcado_por text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.visita_id, c.lat, c.lng, c.precisao_m, c.marcado_em,
         coalesce(t.matricula, p.email)
    from casa_cliente c
    join visita v on v.id = c.visita_id
    left join tecnico t on t.id = c.tecnico_id
    left join perfil p on p.id = c.usuario_id
   where c.visita_id = any (p_visitas)
     and v.empresa_id = (select minha_empresa())
     and v.base_id in (select bases_visiveis())
     and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_legiveis()));
$function$;

revoke all on function public.casa_marcada_na_visita(uuid[]) from public, anon;
grant execute on function public.casa_marcada_na_visita(uuid[]) to authenticated;

create or replace function public.local_da_baixa(p_visitas uuid[])
 returns table(visita_id uuid, em timestamp with time zone, tipo text, login text, lat double precision, lng double precision, precisao_m numeric, cliente_lat double precision, cliente_lng double precision, distancia_m integer, raio_m integer, fora_do_raio boolean, registros integer, registros_fora integer, fonte text, minutos_do_ponto integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  with raio as materialized (
    select coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'raio_baixa_m'), 200) as m,
           coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'rastro_baixa_tolerancia_min'), 10) as tol,
           coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'rastro_precisao_max_m'), 100) as prec
  ),
  -- 191: 1º a marca da casa feita nesta visita (a mais recente)
  marcas as materialized (
    select m.visita_id, m.marcado_em, m.marcado_por, m.lat, m.lng, m.precisao_m,
           v.lat::double precision as clat, v.lng::double precision as clng,
           distancia_m(m.lat, m.lng, v.lat::double precision, v.lng::double precision) as dist
      from casa_marcada_na_visita(p_visitas) m
      join visita v on v.id = m.visita_id
  ),
  casa as materialized (
    select distinct on (mc.visita_id)
           mc.visita_id, mc.marcado_em as em, 'CASA_MARCADA'::text as tipo, mc.marcado_por as login,
           mc.lat, mc.lng, mc.precisao_m, mc.clat, mc.clng, mc.dist, r.m as raio,
           (count(*) over w)::integer as registros,
           (count(*) filter (where mc.dist > r.m) over w)::integer as registros_fora,
           'CASA'::text as fonte, null::integer as minutos
      from marcas mc cross join raio r
    window w as (partition by mc.visita_id)
     order by mc.visita_id, mc.marcado_em desc
  ),
  ev as materialized (
    select e.visita_id, e.criado_em, e.tipo, e.login,
           e.lat::double precision as lat, e.lng::double precision as lng, e.precisao_m,
           v.lat::double precision as clat, v.lng::double precision as clng,
           distancia_m(e.lat::double precision, e.lng::double precision,
                       v.lat::double precision, v.lng::double precision) as dist
      from visita_evento e
      join visita v on v.id = e.visita_id
     where e.visita_id = any (p_visitas)
       and e.origem = 'MOBILE'
       and e.lat is not null and e.lng is not null
       and (e.tipo = 'BAIXA'
            or (e.tipo = 'SITUACAO' and e.para->>'situacao' = any (situacoes_terminais())))
       and not exists (select 1 from casa c where c.visita_id = e.visita_id)
  ),
  app as materialized (
    select distinct on (ev.visita_id)
           ev.visita_id, ev.criado_em as em, ev.tipo, ev.login, ev.lat, ev.lng, ev.precisao_m,
           ev.clat, ev.clng, ev.dist, r.m as raio,
           (count(*) over w)::integer as registros,
           (count(*) filter (where ev.dist > r.m) over w)::integer as registros_fora,
           'APP'::text as fonte, null::integer as minutos
      from ev cross join raio r
    window w as (partition by ev.visita_id)
     order by ev.visita_id, ev.dist desc nulls last, ev.criado_em desc
  ),
  janela as materialized (
    select v.id, v.tecnico_responsavel_id as tec, v.fim, t.matricula,
           v.lat::double precision as clat, v.lng::double precision as clng,
           coalesce(v.inicio, v.fim) - make_interval(mins => r.tol) as de,
           v.fim + make_interval(mins => r.tol) as ate,
           r.m as raio, r.prec
      from visita v
      cross join raio r
      join tecnico t on t.id = v.tecnico_responsavel_id
     where v.id = any (p_visitas)
       and v.fim is not null
       and v.finalizado_toa
       and v.situacao = any (situacoes_terminais())
       and norm_txt(coalesce(v.dados_origem->>'Status da Atividade',''))
             in ('CONCLUIDO', 'NAO CONCLUIDO')
       and not exists (select 1 from app a where a.visita_id = v.id)
       and not exists (select 1 from casa c where c.visita_id = v.id)
  ),
  pts as materialized (
    select j.id as visita_id, rp.capturado_em, rp.lat, rp.lng, rp.precisao_m,
           distancia_m(rp.lat, rp.lng, j.clat, j.clng) as dist,
           j.raio, j.fim, j.matricula, j.clat, j.clng
      from janela j
      join rastro_ponto rp
        on rp.tecnico_id = j.tec
       and rp.capturado_em between j.de and j.ate
       and not rp.simulado
       and coalesce(rp.precisao_m, 0) <= j.prec
  ),
  rastro as materialized (
    select distinct on (p.visita_id)
           p.visita_id, p.capturado_em as em, 'RASTRO_TOA'::text as tipo,
           p.matricula as login, p.lat, p.lng, p.precisao_m::numeric,
           p.clat, p.clng, p.dist, p.raio,
           (count(*) over w)::integer as registros,
           (count(*) filter (where p.dist > p.raio) over w)::integer as registros_fora,
           'RASTRO'::text as fonte,
           round(abs(extract(epoch from (p.capturado_em - p.fim)) / 60))::integer as minutos
      from pts p
    window w as (partition by p.visita_id)
     order by p.visita_id, p.dist asc nulls last,
              abs(extract(epoch from (p.capturado_em - p.fim)))
  ),
  tudo as (select * from casa union all select * from app union all select * from rastro)
  select t.visita_id, t.em, t.tipo, t.login, t.lat, t.lng, t.precisao_m,
         t.clat, t.clng, t.dist, t.raio,
         case when t.dist is null then null else t.dist > t.raio end,
         t.registros, t.registros_fora, t.fonte, t.minutos
    from tudo t;
$function$;

notify pgrst, 'reload schema';
