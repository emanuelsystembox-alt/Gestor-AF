-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 190 — A que distância o técnico está da casa do cliente, ao vivo      │
-- │                                                                      │
-- │ "quando o contrato estiver em deslocamento, em execução, o sistema   │
-- │  deve atualizar em tempo real a localização do técnico com relação a │
-- │  casa do assinante, deve mostrar se de fato o deslocamento (...)     │
-- │  está diminuindo o raio, a mesma coisa para quando estiver em        │
-- │  execução, se a localização mapeada está no raio de 200 metros"      │
-- │  — Emanuel, 03/11.                                                   │
-- │                                                                      │
-- │ Para cada contrato EM DESLOCAMENTO ou EM EXECUÇÃO de hoje, com       │
-- │ técnico: o ÚLTIMO ponto do rastro dele (12 h para trás, real, com    │
-- │ precisão até `rastro_precisao_max_m`) e o ponto de pelo menos 2 min  │
-- │ antes, os dois medidos até a coordenada do endereço (a mesma de      │
-- │ `local_da_baixa`) — a tela diz se está chegando, se afastando ou     │
-- │ parado, e se está no raio (`raio_baixa_m`, 200 m).                   │
-- │                                                                      │
-- │ O que NÃO é "no raio" (regra 6): endereço sem coordenada → distância │
-- │ nula; técnico sem ponto → sem linha. A idade do ponto vai junto: no  │
-- │ Expo Go o rastro para com o app fechado, e um ponto de 40 min atrás  │
-- │ não é "onde ele está".                                               │
-- │                                                                      │
-- │ INVOKER: quem não lê o rastro (RLS da 186) não recebe linha. O local │
-- │ do encerramento continua sendo o de `local_da_baixa` (135/155h).     │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.aproximacao_do_tecnico(p_visitas uuid[])
returns table (
  visita_id uuid, situacao text,
  ponto_em timestamptz, lat double precision, lng double precision, precisao_m real,
  motivo text, cliente_lat double precision, cliente_lng double precision,
  distancia_m integer, antes_em timestamptz, distancia_antes_m integer,
  raio_m integer, no_raio boolean
)
language sql
stable
set search_path to 'public'
as $function$
  with par as materialized (
    select coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'raio_baixa_m'), 200) as raio,
           coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'rastro_precisao_max_m'), 100) as prec
  ),
  alvo as materialized (
    select v.id, v.situacao, v.tecnico_responsavel_id as tec,
           v.lat::double precision as clat, v.lng::double precision as clng
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.id = any (p_visitas)
       -- jornada (Na Base, Refeição) não tem casa de cliente
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
       and v.tecnico_responsavel_id is not null
       and v.data_agendada = hoje_local()
  )
  select a.id, a.situacao,
         u.capturado_em, u.lat, u.lng, u.precisao_m, u.motivo,
         a.clat, a.clng,
         distancia_m(u.lat, u.lng, a.clat, a.clng),
         p.capturado_em,
         case when p.capturado_em is not null then distancia_m(p.lat, p.lng, a.clat, a.clng) end,
         par.raio,
         case when a.clat is null or a.clng is null then null
              else distancia_m(u.lat, u.lng, a.clat, a.clng) <= par.raio end
    from alvo a
    cross join par
    cross join lateral (
      select rp.capturado_em, rp.lat, rp.lng, rp.precisao_m, rp.motivo
        from rastro_ponto rp
       where rp.tecnico_id = a.tec
         and rp.capturado_em >= now() - interval '12 hours'
         and not rp.simulado
         and coalesce(rp.precisao_m, 0) <= par.prec
       order by rp.capturado_em desc
       limit 1) u
    left join lateral (
      select rp.capturado_em, rp.lat, rp.lng
        from rastro_ponto rp
       where rp.tecnico_id = a.tec
         and rp.capturado_em <= u.capturado_em - interval '2 minutes'
         and rp.capturado_em >= u.capturado_em - interval '60 minutes'
         and not rp.simulado
         and coalesce(rp.precisao_m, 0) <= par.prec
       order by rp.capturado_em desc
       limit 1) p on true;
$function$;

revoke all on function public.aproximacao_do_tecnico(uuid[]) from public, anon;
grant execute on function public.aproximacao_do_tecnico(uuid[]) to authenticated;

notify pgrst, 'reload schema';
