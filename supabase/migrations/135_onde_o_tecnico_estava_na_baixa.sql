-- ┌─ 135 · onde o técnico estava quando a baixa aconteceu ─────────────┐
-- │ > "quando o status mudar do contrato para concluído ou reagendado, │
-- │ >  é interessante o nosso sistema puxar pela localização do        │
-- │ >  celular dele onde ele estava (...) toda baixa do técnico tem    │
-- │ >  que ser num raio de 200 metros da casa do cliente"              │
-- │ >  — Emanuel, 25/10                                                │
-- │                                                                     │
-- │ O raio de 200 m já existia (096, D-170), mas só enxergava a baixa  │
-- │ feita PELO CELULAR. A baixa feita no TOA — que é a maioria hoje —  │
-- │ ficava "sem registro do campo".                                     │
-- │                                                                     │
-- │ ┌─ o que eu achei no dado, e por que NÃO virou local da baixa ───┐ │
-- │ │ A planilha do TOA traz `Foto - Justificativa Geolocalizacao`   │ │
-- │ │ com a coordenada que o PRÓPRIO TOA capturou:                    │ │
-- │ │   "capture_image.jpg, 105KB, -3.10951x-60.06642"                │ │
-- │ │ Parecia a resposta pronta. Medido em 615 visitas de 7 dias:     │ │
-- │ │ 607 delas a mais de 200 m do cliente, média de 3,7 km — e as    │ │
-- │ │ observações do técnico dizem "a caminho" (95), "em deslocamento"│ │
-- │ │ (58), "trânsito" (19). É a justificativa DO DESLOCAMENTO, não   │ │
-- │ │ da baixa. Usá-la como local da baixa acusaria o técnico inteiro │ │
-- │ │ de baixar longe, com um dado que não fala disso.                │ │
-- │ │ Ela entra como DADO PRÓPRIO na tela, com o texto do técnico.    │ │
-- │ └─────────────────────────────────────────────────────────────────┘ │
-- │                                                                     │
-- │ O local da baixa passa a ter duas fontes, nesta ordem:             │
-- │  1. APP    — registro do campo com GPS (como já era);              │
-- │  2. RASTRO — o ponto do rastro mais próximo da hora do `fim` do    │
-- │     TOA, dentro de `rastro_baixa_tolerancia_min` (10 min), e só    │
-- │     quando `finalizado_toa` (D-103: `fim` vem preenchido até em    │
-- │     atividade só INICIADA).                                        │
-- │ Sem nenhuma das duas não há linha — e "sem leitura" nunca é        │
-- │ "dentro do raio" (regra 6).                                        │
-- │                                                                     │
-- │ COBERTURA HOJE: o rastro tem 58 pontos, de 1 técnico (o aparelho   │
-- │ de teste) — cobre 4 de 1.424 baixas da semana. A regra fica pronta │
-- │ e cresce quando o APK estiver no campo e os técnicos derem ciência.│
-- └─────────────────────────────────────────────────────────────────────┘

-- ── A · a coordenada que o TOA capturou, sem coluna para preencher ───
alter table visita
  add column if not exists toa_geo_lat double precision
    generated always as (
      ((regexp_match(dados_origem ->> 'Foto - Justificativa Geolocalizacao',
                     '(-?\d+\.\d+)x(-?\d+\.\d+)'))[1])::double precision) stored,
  add column if not exists toa_geo_lng double precision
    generated always as (
      ((regexp_match(dados_origem ->> 'Foto - Justificativa Geolocalizacao',
                     '(-?\d+\.\d+)x(-?\d+\.\d+)'))[2])::double precision) stored;

comment on column visita.toa_geo_lat is
  'Latitude que o TOA capturou na justificativa de geolocalizacao (135). E o que a CLARO viu, no DESLOCAMENTO -- nao o lugar da baixa.';

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'rastro_baixa_tolerancia_min', '10'::jsonb,
       'Minutos de tolerancia para casar o ponto do rastro do celular com a hora da baixa no TOA. Fora disso, o sistema diz que nao sabe onde o tecnico estava.'
  from empresa e
 where not exists (select 1 from parametro p where p.empresa_id = e.id and p.chave = 'rastro_baixa_tolerancia_min');

-- ── B · local_da_baixa com a fonte declarada ─────────────────────────
-- `create or replace` não aceita coluna nova no `returns table`: derruba
-- e recria — e função recriada nasce com a ACL aberta (security.md).
drop function if exists public.local_da_baixa(uuid[]);

create function public.local_da_baixa(p_visitas uuid[])
 returns table(visita_id uuid, em timestamp with time zone, tipo text, login text,
               lat double precision, lng double precision, precisao_m numeric,
               cliente_lat double precision, cliente_lng double precision,
               distancia_m integer, raio_m integer, fora_do_raio boolean,
               registros integer, registros_fora integer,
               fonte text, minutos_do_ponto integer)
 language sql stable set search_path to 'public'
as $function$
  with raio as materialized (
    select coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'raio_baixa_m'), 200) as m,
           coalesce((select (valor #>> '{}')::integer from parametro
                      where empresa_id = (select minha_empresa())
                        and chave = 'rastro_baixa_tolerancia_min'), 10) as tol
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
  rastro as materialized (
    select v.id as visita_id, p.capturado_em as em, 'RASTRO_TOA'::text as tipo,
           t.matricula as login, p.lat, p.lng, p.precisao_m::numeric,
           v.lat::double precision as clat, v.lng::double precision as clng,
           distancia_m(p.lat, p.lng, v.lat::double precision, v.lng::double precision) as dist,
           r.m as raio, 1 as registros, 0 as registros_fora,
           'RASTRO'::text as fonte,
           round(abs(extract(epoch from (p.capturado_em - v.fim)) / 60))::integer as minutos
      from visita v
      cross join raio r
      join tecnico t on t.id = v.tecnico_responsavel_id
      join lateral (
        select rp.capturado_em, rp.lat, rp.lng, rp.precisao_m
          from rastro_ponto rp
         where rp.tecnico_id = v.tecnico_responsavel_id
           and rp.capturado_em between v.fim - make_interval(mins => r.tol)
                                   and v.fim + make_interval(mins => r.tol)
         order by abs(extract(epoch from (rp.capturado_em - v.fim)))
         limit 1) p on true
     where v.id = any (p_visitas)
       and v.fim is not null
       and v.finalizado_toa
       and v.situacao = any (situacoes_terminais())
       and not exists (select 1 from app a where a.visita_id = v.id)
  ),
  tudo as (select * from app union all select * from rastro)
  select t.visita_id, t.em, t.tipo, t.login, t.lat, t.lng, t.precisao_m,
         t.clat, t.clng, t.dist, t.raio,
         case when t.dist is null then null else t.dist > t.raio end,
         t.registros, t.registros_fora, t.fonte, t.minutos
    from tudo t;
$function$;

revoke all on function public.local_da_baixa(uuid[]) from public, anon;
grant execute on function public.local_da_baixa(uuid[]) to authenticated, service_role;

-- ── C · de onde a foto foi ENVIADA ───────────────────────────────────
-- > "quando ele lançar uma evidência da galeria (...) o sistema deve
-- >  pegar a localização de onde ele está enviando aquelas fotos (...)
-- >  nos anexos vai informar se ele enviou da galeria próximo da casa do
-- >  cliente ou não" — Emanuel, 25/10
--
-- `lat/lng` é onde a FOTO foi TIRADA (da câmera, agora; da galeria, o
-- EXIF, ou nulo — 132). Isto é outra pergunta: onde o CELULAR estava no
-- instante do envio. Duas colunas porque são dois fatos; juntar faria a
-- foto da galeria mentir o lugar.
alter table evidencia
  add column if not exists envio_lat numeric,
  add column if not exists envio_lng numeric,
  add column if not exists envio_precisao_m numeric;

comment on column evidencia.envio_lat is
  'Onde o celular estava no instante do ENVIO (135). Nao e onde a foto foi tirada: isso e lat/lng.';

-- `registrar_evidencia` ganha os três parâmetros (e, pela 136, passa a
-- pedir `pode_anexar_na_visita(..., true)` — o prazo da evidência).
-- A versão de 14 parâmetros SAI: duas juntas deixam a chamada ambígua
-- no PostgREST (traps.md).
drop function if exists public.registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
  numeric, numeric, numeric, timestamptz, integer, text, boolean);

create function public.registrar_evidencia(
  p_visita uuid, p_arquivo_path text, p_tipo text default 'LIVRE', p_midia text default 'FOTO',
  p_os uuid default null, p_mime text default null, p_bytes bigint default null,
  p_lat numeric default null, p_lng numeric default null, p_precisao_m numeric default null,
  p_capturada_em timestamptz default null, p_duracao_seg integer default null,
  p_observacao text default null, p_galeria boolean default false,
  p_envio_lat numeric default null, p_envio_lng numeric default null,
  p_envio_precisao_m numeric default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tecnico uuid; v_login text; v_id uuid; v_origem text;
begin
  -- 136: evidência tem prazo próprio (até o fim do dia seguinte).
  perform pode_anexar_na_visita(p_visita, true);

  if coalesce(btrim(p_arquivo_path), '') = '' then
    raise exception 'Caminho do arquivo vazio.' using errcode = '23514';
  end if;
  if visita_do_path(p_arquivo_path) is distinct from p_visita then
    raise exception 'O caminho tem de comecar pelo id do contrato.'
      using errcode = '23514';
  end if;
  if p_midia not in ('FOTO','VIDEO') then
    raise exception 'Midia deve ser FOTO ou VIDEO.' using errcode = '23514';
  end if;
  if p_os is not null and not exists (
       select 1 from ordem_servico where id = p_os and visita_id = p_visita) then
    raise exception 'Esta O.S. nao e deste contrato.' using errcode = '23503';
  end if;

  v_tecnico := meu_tecnico_id();
  v_login := coalesce((select matricula from tecnico where id = v_tecnico),
                      (select email from perfil where id = auth.uid()));
  v_origem := case when tem_papel('TECNICO') and not eh_gestor()
                   then 'MOBILE' else 'WEB' end;

  insert into evidencia (visita_id, os_id, tipo, arquivo_path, midia, mime,
                         tamanho_bytes, duracao_seg, lat, lng, precisao_m,
                         capturada_em, tecnico_id, usuario_id, login, origem,
                         observacao, da_galeria, envio_lat, envio_lng, envio_precisao_m)
  values (p_visita, p_os, upper(btrim(p_tipo)), p_arquivo_path, p_midia, p_mime,
          p_bytes, p_duracao_seg, p_lat, p_lng, p_precisao_m,
          case when coalesce(p_galeria, false) then p_capturada_em
               else coalesce(p_capturada_em, now()) end,
          v_tecnico, auth.uid(), v_login, v_origem,
          nullif(btrim(coalesce(p_observacao,'')),''), coalesce(p_galeria, false),
          p_envio_lat, p_envio_lng, p_envio_precisao_m)
  returning id into v_id;

  insert into visita_evento (visita_id, os_id, tipo, para, origem, usuario_id,
                             login, tecnico_id, lat, lng, observacao)
  values (p_visita, p_os, 'EVIDENCIA',
          jsonb_build_object('evidencia_id', v_id, 'midia', p_midia,
                             'tipo', upper(btrim(p_tipo)), 'galeria', coalesce(p_galeria, false)),
          v_origem, auth.uid(), v_login, v_tecnico,
          -- o evento carrega de onde foi ENVIADA quando a foto não tem lugar próprio
          coalesce(p_lat, p_envio_lat), coalesce(p_lng, p_envio_lng),
          nullif(btrim(coalesce(p_observacao,'')),''));

  return v_id;
end;
$function$;

revoke all on function public.registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
  numeric, numeric, numeric, timestamptz, integer, text, boolean, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.registrar_evidencia(uuid, text, text, text, uuid, text, bigint,
  numeric, numeric, numeric, timestamptz, integer, text, boolean, numeric, numeric, numeric)
  to authenticated, service_role;

notify pgrst, 'reload schema';
