-- ┌─ 133 · o controle fala com as outras pessoas da gestão ─────────────┐
-- │ > "Vamos adicionar além do técnico pessoas de outros setores (...)  │
-- │ >  cada usuário vai poder escolher isso (...) da parte do técnico   │
-- │ >  já vi que está ok, falta agora do controlador" — Emanuel, 25/10  │
-- │                                                                     │
-- │ A 132 deu ao TÉCNICO o direito de escolher PARA QUEM manda. Esta dá │
-- │ o mesmo a quem está no site: além dos técnicos, a lista "falar com" │
-- │ passa a ter PESSOAS.                                                │
-- │                                                                     │
-- │ QUEM APARECE: o MESMO grupo que o técnico escolhe hoje — COP,       │
-- │ supervisor e coordenador — da cidade ativa. Escolha do Emanuel      │
-- │ (25/10) entre esta, "todo mundo da cidade" e "qualquer cidade".     │
-- │ A classificação deixa de estar COPIADA dentro de                    │
-- │ `destinatarios_do_campo` e passa a morar em `grupo_interno`: uma    │
-- │ regra, dois lugares que perguntam. Mudar o de/para de cargo em um   │
-- │ lugar deixava o campo e o controle com listas diferentes.           │
-- │                                                                     │
-- │ QUEM LÊ: só as duas pessoas (Emanuel, 25/10 — a outra opção,        │
-- │ "as duas e o ADMIN", foi oferecida e recusada). É por isso que é    │
-- │ TABELA NOVA e não `mensagem` com `tecnico_id` nulo: lá a policy     │
-- │ abre a conversa para todo controlador que enxerga a equipe (091),   │
-- │ que é o certo para o turno e o errado para conversa entre duas      │
-- │ pessoas. Aqui nem o ADMIN lê — o RLS não tem exceção para ele.      │
-- │                                                                     │
-- │ RESPONDER SEMPRE PODE: quem recebeu responde mesmo que o remetente  │
-- │ não esteja na lista dele (hoje o ADMIN sem cargo não tem grupo e    │
-- │ ficaria com a conversa sem volta). Abrir é que é restrito.          │
-- │                                                                     │
-- │ Medido em 25/10: 2 coordenadores cadastrados, nenhum COP nem        │
-- │ supervisor — a lista nasce curta e cresce com o cadastro.           │
-- └─────────────────────────────────────────────────────────────────────┘

-- ── diretor e gerente existem, e ficam FORA da conversa ──────────────
-- > "Márcio é GERENTE e ALISSON é o Diretor, eles não podem aparecer no
-- >  chat, não faz sentido, agora eles podem visualizar as outras
-- >  pessoas e enviar mensagem se quiserem (...) no aplicativo também o
-- >  técnico não pode visualizar os dois" — Emanuel, 25/10
--
-- Os dois cargos não existiam no cadastro, e os dois estavam como
-- COORDENADOR — era por isso que apareciam para o técnico escolher.
-- `grupo_interno` não classifica DIRETOR nem GERENTE: sem grupo, a
-- pessoa não entra em lista nenhuma. ESCREVER continua podendo (os dois
-- são ADMIN, e quem recebe sempre pode responder) — o que some é o nome
-- na lista de quem o campo e o controle escolhem.
insert into cargo (empresa_id, nome, ordem)
select (select empresa_id from cargo where nome = 'COORDENADOR' limit 1), x.nome, x.ordem
  from (values ('DIRETOR', 1), ('GERENTE', 2)) as x(nome, ordem)
 where not exists (select 1 from cargo c where c.nome = x.nome);

-- ── a regra de grupo, num lugar só ───────────────────────────────────
create or replace function public.grupo_interno(p_usuario uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
           when upper(coalesce(c.nome, '')) like 'COORDENADOR%' then 'COORDENADOR'
           when upper(coalesce(c.nome, '')) like 'SUPERVISOR%'
             or pa.nome = 'Supervisor' then 'SUPERVISOR'
           when upper(coalesce(c.nome, '')) like '%COP%'
             or pa.nome in ('COP', 'Controlador') then 'COP'
         end
    from perfil p
    left join cargo c on c.id = p.cargo_id
    left join perfil_acesso pa on pa.id = p.perfil_acesso_id
   where p.id = p_usuario and p.ativo;
$function$;

comment on function public.grupo_interno(uuid) is
  'COP, SUPERVISOR ou COORDENADOR — o grupo da pessoa na conversa (132/133). Nulo = nao recebe conversa direta.';

revoke all on function public.grupo_interno(uuid) from public, anon;
grant execute on function public.grupo_interno(uuid) to authenticated, service_role;

-- ── quem pode ser escolhido, numa base ───────────────────────────────
create or replace function public.pessoas_da_gestao(p_base uuid)
returns table(usuario_id uuid, nome text, grupo text, cargo text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, coalesce(nullif(p.apelido, ''), p.nome), grupo_interno(p.id), c.nome
    from perfil p
    left join cargo c on c.id = p.cargo_id
   where p.ativo
     and p.empresa_id = minha_empresa()
     and p.id <> (select auth.uid())
     and grupo_interno(p.id) is not null
     and (p.base_id = p_base
          or exists (select 1 from usuario_base ub
                      where ub.usuario_id = p.id and ub.base_id = p_base)
          or exists (select 1 from usuario_papel up
                      where up.usuario_id = p.id and up.papel = 'ADMIN'));
$function$;

revoke all on function public.pessoas_da_gestao(uuid) from public, anon;
grant execute on function public.pessoas_da_gestao(uuid) to authenticated, service_role;

-- ── o campo escolhe (132), agora pela regra compartilhada ────────────
create or replace function public.destinatarios_do_campo()
returns table(usuario_id uuid, nome text, grupo text, cargo text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select d.usuario_id, d.nome, d.grupo, d.cargo
    from tecnico t
    cross join lateral pessoas_da_gestao(t.base_id) d
   where t.id = meu_tecnico_id()
   order by d.grupo, d.nome;
$function$;

revoke all on function public.destinatarios_do_campo() from public, anon;
grant execute on function public.destinatarios_do_campo() to authenticated, service_role;

-- ── a gestão escolhe: as pessoas da CIDADE ATIVA ─────────────────────
create or replace function public.destinatarios_da_gestao()
returns table(usuario_id uuid, nome text, grupo text, cargo text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select q.usuario_id, q.nome, q.grupo, q.cargo
    from (select distinct on (d.usuario_id) d.usuario_id, d.nome, d.grupo, d.cargo
            from bases_visiveis() as b(base)
            cross join lateral pessoas_da_gestao(b.base) d
           order by d.usuario_id) q
   order by q.grupo, q.nome;
$function$;

comment on function public.destinatarios_da_gestao() is
  'Com quem a gestao pode abrir conversa (133): COP, supervisor e coordenador da cidade ativa.';

revoke all on function public.destinatarios_da_gestao() from public, anon;
grant execute on function public.destinatarios_da_gestao() to authenticated, service_role;

-- ── a conversa entre duas pessoas ────────────────────────────────────
create table if not exists mensagem_interna (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresa(id) on delete cascade,
  de_usuario_id uuid not null references perfil(id),
  para_usuario_id uuid not null references perfil(id),
  texto text not null,
  criado_em timestamptz not null default now(),
  lida_em timestamptz,
  constraint mensagem_interna_texto_ck check (btrim(texto) <> '' and length(texto) <= 2000),
  constraint mensagem_interna_outro_ck check (de_usuario_id <> para_usuario_id)
);

comment on table mensagem_interna is
  'Conversa direta entre duas pessoas da gestao (133). Privada: so remetente e destinatario leem.';

create index if not exists mensagem_interna_de_ix
  on mensagem_interna (de_usuario_id, criado_em desc);
create index if not exists mensagem_interna_para_ix
  on mensagem_interna (para_usuario_id, criado_em desc);

alter table mensagem_interna enable row level security;

drop policy if exists mensagem_interna_leitura on mensagem_interna;
create policy mensagem_interna_leitura on mensagem_interna
  for select to authenticated
  using (empresa_id = (select minha_empresa())
         and (select auth.uid()) in (de_usuario_id, para_usuario_id));
-- Sem policy de INSERT/UPDATE/DELETE de proposito: quem escreve e marca
-- lida e a RPC (SECURITY DEFINER), que carimba o autor (D-061).

-- ── enviar ───────────────────────────────────────────────────────────
create or replace function public.enviar_mensagem_interna(p_para uuid, p_texto text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id bigint;
begin
  if nullif(btrim(coalesce(p_texto, '')), '') is null then
    raise exception 'Mensagem vazia.' using errcode = '23514';
  end if;
  if length(btrim(p_texto)) > 2000 then
    raise exception 'Mensagem longa demais (maximo 2000 caracteres).' using errcode = '23514';
  end if;
  if p_para = auth.uid() then
    raise exception 'Nao da para conversar consigo mesmo.' using errcode = '23514';
  end if;
  if not (eh_gestao() or grupo_interno(auth.uid()) is not null) then
    raise exception 'Esta conversa e entre pessoas da gestao.' using errcode = '42501';
  end if;
  -- Abrir e restrito a lista; RESPONDER quem ja escreveu para voce, nao.
  if not exists (select 1 from destinatarios_da_gestao() d where d.usuario_id = p_para)
     and not exists (select 1 from mensagem_interna m
                      where m.de_usuario_id = p_para and m.para_usuario_id = auth.uid()) then
    raise exception 'Esta pessoa nao esta disponivel para voce.' using errcode = '42501';
  end if;

  insert into mensagem_interna (empresa_id, de_usuario_id, para_usuario_id, texto)
  values (minha_empresa(), auth.uid(), p_para, btrim(p_texto))
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.enviar_mensagem_interna(uuid, text) from public, anon;
grant execute on function public.enviar_mensagem_interna(uuid, text) to authenticated, service_role;

-- ── a caixa de entrada das conversas internas ────────────────────────
create or replace function public.conversas_internas()
returns table(usuario_id uuid, nome text, grupo text, cargo text,
              ultima_texto text, ultima_em timestamptz, ultima_minha boolean,
              nao_lidas bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  with eu as materialized (
    select (select auth.uid()) as uid, (select minha_empresa()) as emp
  ),
  par as (
    select case when m.de_usuario_id = eu.uid then m.para_usuario_id
                else m.de_usuario_id end as outro,
           m.texto, m.criado_em, m.lida_em,
           m.de_usuario_id = eu.uid as minha
      from mensagem_interna m, eu
     where m.empresa_id = eu.emp
       and eu.uid in (m.de_usuario_id, m.para_usuario_id)
  ),
  ult as (
    select distinct on (outro) outro, texto, criado_em, minha
      from par order by outro, criado_em desc
  )
  select u.outro, coalesce(nullif(p.apelido, ''), p.nome),
         grupo_interno(u.outro), c.nome,
         u.texto, u.criado_em, u.minha,
         (select count(*) from par x
           where x.outro = u.outro and not x.minha and x.lida_em is null)
    from ult u
    join perfil p on p.id = u.outro
    left join cargo c on c.id = p.cargo_id
   order by u.criado_em desc;
$function$;

revoke all on function public.conversas_internas() from public, anon;
grant execute on function public.conversas_internas() to authenticated, service_role;

-- ── marcar lida ──────────────────────────────────────────────────────
create or replace function public.marcar_interna_lida(p_de uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  update mensagem_interna
     set lida_em = now()
   where de_usuario_id = p_de
     and para_usuario_id = auth.uid()
     and lida_em is null;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.marcar_interna_lida(uuid) from public, anon;
grant execute on function public.marcar_interna_lida(uuid) to authenticated, service_role;

-- ── o carregador: a linha continua sendo a verdade (D-119) ───────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'mensagem_interna') then
    alter publication supabase_realtime add table mensagem_interna;
  end if;
end $$;

notify pgrst, 'reload schema';
