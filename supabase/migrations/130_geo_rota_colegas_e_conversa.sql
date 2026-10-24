-- ┌─ 130 · Geo-Rota: os colegas por perto e a conversa entre técnicos ─────┐
-- │ > "um novo menu chamado Geo - Rota (...) onde cada contrato caiu pra  │
-- │ >  ele no mapa (...) por cores (...) e além disso essa função também  │
-- │ >  irá mostrar os outros colegas, onde cada um está, caso ele queira  │
-- │ >  pedir ajuda de alguém próximo ou pedir algum equipamento, ele vai  │
-- │ >  conseguir mandar mensagem direto pra esse amigo (...) ver o número │
-- │ >  da equipe e nome do técnico mais próximo" — Emanuel, 24/10         │
-- │                                                                       │
-- │ MUDA A REGRA 096 ("só a gestão lê o rastro"), dentro do que o Emanuel │
-- │ escolheu (24/10):                                                     │
-- │  · o técnico vê só a ÚLTIMA POSIÇÃO (nunca a trilha) dos colegas da   │
-- │    MESMA CIDADE (`bases_visiveis()`), que estão EM ROTA HOJE (contrato│
-- │    produtivo do dia em aberto), visto há no máximo 30 min, ponto real │
-- │    (simulado não entra);                                              │
-- │  · e só de quem deu "Estou ciente" no texto NOVO (rastro-v2), que diz │
-- │    que os colegas veem a posição. Quem não deu, não aparece — o       │
-- │    técnico sabe o que é mostrado dele (096).                          │
-- │ A trilha (`rastro_ponto`) continua só para a gestão: a leitura passa  │
-- │ por esta função DEFINER, que devolve uma linha por colega.            │
-- │                                                                       │
-- │ A CONVERSA ENTRE TÉCNICOS (`mensagem_colega`): os dois leem, e a      │
-- │ gestão que enxerga a equipe de um deles também (escolha do Emanuel —  │
-- │ pedido de equipamento entre colegas fica registrado). Só se escreve   │
-- │ pela RPC: o autor é carimbado pelo servidor (D-061). Linha magra no   │
-- │ Realtime (sem dado de assinante).                                     │
-- └───────────────────────────────────────────────────────────────────────┘

-- ── os colegas por perto ───────────────────────────────────────────────
create or replace function public.colegas_por_perto(p_lat double precision default null,
                                                    p_lng double precision default null)
returns table(tecnico_id uuid, nome text, equipe text, lat double precision, lng double precision,
              precisao_m real, visto_em timestamptz, distancia_m integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with eu as materialized (select meu_tecnico_id() as id, minha_empresa() as empresa),
  bases as materialized (select b from bases_visiveis() b),
  colegas as materialized (
    select t.id, t.nome, e.codigo as equipe, t.usuario_id
      from tecnico t
      cross join eu
      left join equipe e on e.id = t.equipe_id
     where t.empresa_id = eu.empresa
       and t.base_id in (select b from bases)
       and t.id is distinct from eu.id
       and coalesce(t.situacao, 'ATIVO') = 'ATIVO'
       -- em rota HOJE: contrato produtivo do dia ainda em aberto
       and exists (select 1 from visita v
                     join situacao_visita s on s.codigo = v.situacao and s.em_aberto
                     left join tipo_atividade ta on ta.id = v.tipo_atividade_id
                    where v.tecnico_responsavel_id = t.id and v.excluido_em is null
                      and v.data_agendada = hoje_local()
                      and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA')
       -- deu ciência do texto que diz que os colegas veem a posição
       and exists (select 1 from ciencia_rastro c
                    where c.usuario_id = t.usuario_id and c.versao = 'rastro-v2-2026-10-24')
  ),
  ultimo as (
    select c.*, p.lat, p.lng, p.precisao_m, p.capturado_em
      from colegas c
      cross join lateral (
        select r.lat, r.lng, r.precisao_m, r.capturado_em
          from rastro_ponto r
         where r.tecnico_id = c.id
           and r.capturado_em > now() - interval '30 minutes'
           and not coalesce(r.simulado, false)
           and r.lat is not null and r.lng is not null
         order by r.capturado_em desc
         limit 1) p
  )
  select u.id, u.nome, u.equipe, u.lat, u.lng, u.precisao_m, u.capturado_em,
         case when p_lat is null or p_lng is null then null
              else round(6371000 * 2 * asin(sqrt(
                     power(sin(radians(u.lat - p_lat) / 2), 2)
                     + cos(radians(p_lat)) * cos(radians(u.lat))
                       * power(sin(radians(u.lng - p_lng) / 2), 2))))::int end
    from ultimo u
   order by 8 nulls last, u.nome;
$function$;

revoke all on function public.colegas_por_perto(double precision, double precision) from public, anon;
grant execute on function public.colegas_por_perto(double precision, double precision) to authenticated, service_role;

-- ── a conversa entre técnicos ──────────────────────────────────────────
create table if not exists public.mensagem_colega (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresa(id),
  de_tecnico_id uuid not null references tecnico(id),
  para_tecnico_id uuid not null references tecnico(id),
  autor_id uuid not null,
  texto text not null check (length(btrim(texto)) between 1 and 1000),
  criado_em timestamptz not null default now(),
  lida_em timestamptz,
  check (de_tecnico_id <> para_tecnico_id)
);

comment on table public.mensagem_colega is
  'Conversa entre dois técnicos (130, Geo-Rota). Lida pelos dois e pela gestão que vê a equipe de um deles. Só se escreve por enviar_ao_colega.';

create index if not exists mensagem_colega_par_ix
  on mensagem_colega (least(de_tecnico_id, para_tecnico_id), greatest(de_tecnico_id, para_tecnico_id), criado_em);
create index if not exists mensagem_colega_para_ix on mensagem_colega (para_tecnico_id) where lida_em is null;

alter table mensagem_colega enable row level security;

drop policy if exists mensagem_colega_leitura on mensagem_colega;
create policy mensagem_colega_leitura on mensagem_colega for select to authenticated
  using (empresa_id = (select minha_empresa())
         and (de_tecnico_id = (select meu_tecnico_id())
              or para_tecnico_id = (select meu_tecnico_id())
              or ((select eh_gestao())
                  and ((select eh_gestor())
                       or exists (select 1 from tecnico t
                                   where t.id in (de_tecnico_id, para_tecnico_id)
                                     and t.equipe_id in (select equipes_visiveis()))))));
-- sem policy de INSERT/UPDATE/DELETE: só pelas RPCs abaixo

create or replace function public.enviar_ao_colega(p_para uuid, p_texto text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_eu uuid := meu_tecnico_id(); v_emp uuid := minha_empresa(); v_id bigint;
begin
  if v_eu is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  if p_para is null or p_para = v_eu then
    raise exception 'Escolha um colega.' using errcode = '23514';
  end if;
  if not exists (select 1 from tecnico t
                  where t.id = p_para and t.empresa_id = v_emp
                    and t.base_id in (select bases_visiveis())) then
    raise exception 'Este colega nao e da sua cidade.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_texto, ''))) = 0 then
    raise exception 'Escreva a mensagem.' using errcode = '23514';
  end if;
  insert into mensagem_colega (empresa_id, de_tecnico_id, para_tecnico_id, autor_id, texto)
  values (v_emp, v_eu, p_para, auth.uid(), left(btrim(p_texto), 1000))
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.enviar_ao_colega(uuid, text) from public, anon;
grant execute on function public.enviar_ao_colega(uuid, text) to authenticated, service_role;

create or replace function public.marcar_colega_lida(p_colega uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update mensagem_colega set lida_em = now()
   where para_tecnico_id = meu_tecnico_id() and de_tecnico_id = p_colega and lida_em is null;
$function$;

revoke all on function public.marcar_colega_lida(uuid) from public, anon;
grant execute on function public.marcar_colega_lida(uuid) to authenticated, service_role;

-- Realtime: linha magra (ids, texto e hora; nada do assinante). O app filtra
-- por para_tecnico_id; o RLS de leitura vale por conexão.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'mensagem_colega') then
    execute 'alter publication supabase_realtime add table public.mensagem_colega';
  end if;
end $$;

notify pgrst, 'reload schema';
