-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 156g · GRUPOS no chat                                            ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "o coordenador consiga criar grupos dentro do chat, para falar com o
-- >  COP ou deixar todos os tecnicos ali reunidos, sendo assim evitando o
-- >  uso do WhatsApp"  -- Emanuel, 30/10
--
-- Decisao dele (30/10): TODOS os membros escrevem -- como um grupo de
-- WhatsApp.
--
-- ┌─ como e montado, e por que ──────────────────────────────────────┐
-- │ · O grupo e de UMA cidade (a ativa de quem cria): "os chats nao  │
-- │   podem se embolar". Quem troca de cidade no topo ve os grupos    │
-- │   da outra.                                                       │
-- │ · Quem le e quem e MEMBRO -- e so. Nem o ADMIN le grupo do qual  │
-- │   nao participa: e o mesmo principio da conversa interna (133),  │
-- │   e um grupo que todo gestor pudesse ler sem aparecer na lista   │
-- │   nao substitui o WhatsApp, vira vigilancia.                      │
-- │ · Ninguem escreve direto na tabela: as tres tabelas nao tem       │
-- │   policy de escrita, e as RPCs carimbam o autor (D-061).          │
-- │ · Criar e mexer nos membros: permissao `chat.grupos` (nova, dada  │
-- │   ao Administrador, ao Coordenador e ao COP) -- o ADMIN concede a │
-- │   quem mais quiser em Administracao > Perfis.                     │
-- │ · O escopo de leitura e `grupo_id in (select meus_grupos())`:     │
-- │   uma chamada por consulta, nao uma por linha (D-118).            │
-- │ · `grupo_mensagem` vai para o Realtime: e magra (texto e nome de  │
-- │   quem escreveu), sem dado de assinante (D-119).                  │
-- └────────────────────────────────────────────────────────────────────┘

create table if not exists grupo_chat (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id),
  base_id uuid not null references base(id),
  nome text not null check (length(btrim(nome)) between 1 and 60),
  criado_por uuid references perfil(id),
  criado_em timestamptz not null default now(),
  arquivado_em timestamptz
);

create table if not exists grupo_membro (
  grupo_id uuid not null references grupo_chat(id) on delete cascade,
  usuario_id uuid not null references perfil(id),
  adicionado_por uuid references perfil(id),
  adicionado_em timestamptz not null default now(),
  lido_ate timestamptz,
  primary key (grupo_id, usuario_id)
);
create index if not exists grupo_membro_usuario_idx on grupo_membro (usuario_id);

create table if not exists grupo_mensagem (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupo_chat(id) on delete cascade,
  empresa_id uuid not null references empresa(id),
  usuario_id uuid not null references perfil(id),
  autor_nome text,
  texto text not null check (length(btrim(texto)) between 1 and 2000),
  criado_em timestamptz not null default now()
);
create index if not exists grupo_mensagem_grupo_idx on grupo_mensagem (grupo_id, criado_em desc);

alter table grupo_chat enable row level security;
alter table grupo_membro enable row level security;
alter table grupo_mensagem enable row level security;

-- Os grupos de que EU sou membro. Escopo de leitura das tres tabelas.
create or replace function meus_grupos() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.grupo_id from grupo_membro m
    join grupo_chat g on g.id = m.grupo_id
   where m.usuario_id = auth.uid() and g.empresa_id = minha_empresa();
$$;
revoke all on function meus_grupos() from public, anon;
grant execute on function meus_grupos() to authenticated;

drop policy if exists grupo_chat_leitura on grupo_chat;
create policy grupo_chat_leitura on grupo_chat for select to authenticated
  using (id in (select meus_grupos()));
drop policy if exists grupo_membro_leitura on grupo_membro;
create policy grupo_membro_leitura on grupo_membro for select to authenticated
  using (grupo_id in (select meus_grupos()));
drop policy if exists grupo_mensagem_leitura on grupo_mensagem;
create policy grupo_mensagem_leitura on grupo_mensagem for select to authenticated
  using (grupo_id in (select meus_grupos()));

-- A permissao de criar grupo.
insert into permissao (chave, modulo, rotulo, descricao, ordem, disponivel)
values ('chat.grupos', 'CHAT', 'Criar grupos no chat',
        'Criar grupo, pôr e tirar membros. Todos os membros escrevem.', 1, true)
on conflict (chave) do nothing;
insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select pa.id, 'chat.grupos' from perfil_acesso pa
 where pa.nome in ('Administrador', 'Coordenador', 'COP')
on conflict do nothing;

create or replace function pode_criar_grupo() returns boolean
language sql stable security definer set search_path = public as $$
  select eh_gestor() or tem_permissao('chat.grupos');
$$;
revoke all on function pode_criar_grupo() from public, anon;
grant execute on function pode_criar_grupo() to authenticated;

-- Quem pode entrar num grupo da cidade: a gestao da cidade (cadastro ou
-- "cidades que acessa") e os tecnicos da cidade que TEM login.
create or replace function candidatos_do_grupo()
returns table(usuario_id uuid, nome text, tipo text, equipe text)
language sql stable security definer set search_path = public as $$
  with cid as materialized (select b from bases_visiveis() b)
  select p.id, coalesce(nullif(p.apelido, ''), p.nome),
         case when t.id is not null then 'TECNICO' else 'GESTAO' end,
         e.codigo
    from perfil p
    left join tecnico t on t.usuario_id = p.id and t.situacao = 'ATIVO'
    left join equipe e on e.id = t.equipe_id
   where p.ativo and p.empresa_id = minha_empresa()
     and (p.base_id in (select b from cid)
          or exists (select 1 from usuario_base ub where ub.usuario_id = p.id and ub.base_id in (select b from cid)))
     and not exists (select 1 from usuario_papel up where up.usuario_id = p.id and up.papel = 'ROBO')
   order by 3, 2;
$$;
revoke all on function candidatos_do_grupo() from public, anon;
grant execute on function candidatos_do_grupo() to authenticated;

create or replace function criar_grupo_chat(p_nome text, p_membros uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_base uuid;
begin
  if not pode_criar_grupo() then
    raise exception 'Sem permissao para criar grupo.' using errcode = '42501';
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then raise exception 'Escolha a cidade no topo antes de criar o grupo.'; end if;
  if nullif(btrim(coalesce(p_nome, '')), '') is null then raise exception 'Dê um nome ao grupo.'; end if;

  insert into grupo_chat (empresa_id, base_id, nome, criado_por)
  values (minha_empresa(), v_base, btrim(p_nome), auth.uid()) returning id into v_id;

  -- So entra quem e candidato da cidade; quem cria entra sempre.
  insert into grupo_membro (grupo_id, usuario_id, adicionado_por)
  select v_id, c.usuario_id, auth.uid() from candidatos_do_grupo() c
   where c.usuario_id = any (coalesce(p_membros, '{}'))
  union select v_id, auth.uid(), auth.uid()
  on conflict do nothing;
  return v_id;
end $$;
revoke all on function criar_grupo_chat(text, uuid[]) from public, anon;
grant execute on function criar_grupo_chat(text, uuid[]) to authenticated;

create or replace function mudar_membros_do_grupo(p_grupo uuid, p_entram uuid[], p_saem uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_in int; n_out int;
begin
  if not pode_criar_grupo() then
    raise exception 'Sem permissao para mexer nos membros.' using errcode = '42501';
  end if;
  if not exists (select 1 from grupo_chat g where g.id = p_grupo and g.empresa_id = minha_empresa()
                   and g.base_id in (select bases_visiveis())) then
    raise exception 'Grupo nao encontrado nesta cidade.';
  end if;
  insert into grupo_membro (grupo_id, usuario_id, adicionado_por)
  select p_grupo, c.usuario_id, auth.uid() from candidatos_do_grupo() c
   where c.usuario_id = any (coalesce(p_entram, '{}'))
  on conflict do nothing;
  get diagnostics n_in = row_count;
  delete from grupo_membro where grupo_id = p_grupo and usuario_id = any (coalesce(p_saem, '{}'));
  get diagnostics n_out = row_count;
  return jsonb_build_object('entraram', n_in, 'sairam', n_out);
end $$;
revoke all on function mudar_membros_do_grupo(uuid, uuid[], uuid[]) from public, anon;
grant execute on function mudar_membros_do_grupo(uuid, uuid[], uuid[]) to authenticated;

create or replace function enviar_ao_grupo(p_grupo uuid, p_texto text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_txt text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  if v_txt is null then raise exception 'Mensagem vazia.'; end if;
  if not exists (select 1 from grupo_membro m join grupo_chat g on g.id = m.grupo_id
                  where m.grupo_id = p_grupo and m.usuario_id = auth.uid()
                    and g.arquivado_em is null) then
    raise exception 'Voce nao e membro deste grupo.' using errcode = '42501';
  end if;
  insert into grupo_mensagem (grupo_id, empresa_id, usuario_id, autor_nome, texto)
  select p_grupo, minha_empresa(), auth.uid(),
         (select coalesce(nullif(p.apelido, ''), p.nome) from perfil p where p.id = auth.uid()),
         v_txt
  returning id into v_id;
  update grupo_membro set lido_ate = now() where grupo_id = p_grupo and usuario_id = auth.uid();
  return v_id;
end $$;
revoke all on function enviar_ao_grupo(uuid, text) from public, anon;
grant execute on function enviar_ao_grupo(uuid, text) to authenticated;

create or replace function marcar_grupo_lido(p_grupo uuid) returns void
language sql security definer set search_path = public as $$
  update grupo_membro set lido_ate = now()
   where grupo_id = p_grupo and usuario_id = auth.uid();
$$;
revoke all on function marcar_grupo_lido(uuid) from public, anon;
grant execute on function marcar_grupo_lido(uuid) to authenticated;

-- A caixa de entrada dos grupos: os MEUS, da cidade ativa.
create or replace function grupos_do_chat()
returns table(grupo_id uuid, nome text, membros integer, ultima_texto text, ultima_em timestamptz,
              ultima_autor text, ultima_minha boolean, nao_lidas integer, posso_gerir boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.nome,
         (select count(*)::int from grupo_membro x where x.grupo_id = g.id),
         u.texto, coalesce(u.criado_em, g.criado_em), u.autor_nome, u.usuario_id = auth.uid(),
         (select count(*)::int from grupo_mensagem x
           where x.grupo_id = g.id and x.usuario_id <> auth.uid()
             and x.criado_em > coalesce(m.lido_ate, m.adicionado_em)),
         pode_criar_grupo()
    from grupo_membro m
    join grupo_chat g on g.id = m.grupo_id
    left join lateral (select * from grupo_mensagem x where x.grupo_id = g.id
                        order by x.criado_em desc limit 1) u on true
   where m.usuario_id = auth.uid()
     and g.empresa_id = minha_empresa()
     and g.arquivado_em is null
     and g.base_id in (select bases_visiveis())
   order by coalesce(u.criado_em, g.criado_em) desc;
$$;
revoke all on function grupos_do_chat() from public, anon;
grant execute on function grupos_do_chat() to authenticated;

do $$ begin
  alter publication supabase_realtime add table grupo_mensagem;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
