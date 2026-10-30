-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 157a · PERMISSÕES POR LOGIN — exceções em cima do perfil         ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "preciso de uma tela dessa de permissoes do que podem fazer, olhar,
-- >  controlar (...) nao tem ainda, so separa quem e supervisor, COP e
-- >  coordenador (...) quando for editar algum login tem que ter essas
-- >  opcoes ou ate mais se voce pensar melhor"  -- Emanuel, 30/10
--
-- ┌─ o modelo ────────────────────────────────────────────────────────┐
-- │ O PERFIL continua sendo o padrao (D-055: papel abre a sala,       │
-- │ permissao diz o que se faz dentro). Cada login pode ter EXCECOES: │
-- │ dar uma permissao que o perfil nao da, ou tirar uma que da. Sem   │
-- │ excecao, vale o perfil -- trocar o perfil da pessoa continua      │
-- │ trocando tudo de uma vez, como hoje.                              │
-- │                                                                    │
-- │ Por que excecao e nao "permissoes da pessoa" soltas: com 90       │
-- │ logins, copiar 35 caixas para cada um faria o perfil deixar de    │
-- │ significar alguma coisa, e uma mudanca no perfil COP nao chegaria │
-- │ em ninguem. Excecao guarda so a diferenca.                         │
-- │                                                                    │
-- │ So DUAS funcoes leem permissao (`tem_permissao`, `minhas_         │
-- │ permissoes`) -- o banco e as telas fazem a mesma conta. As duas   │
-- │ passam a olhar a excecao primeiro.                                │
-- └────────────────────────────────────────────────────────────────────┘
--
-- TRAVAS:
--   · ninguem mexe nas PROPRIAS permissoes (a mesma da autoedicao, 028c);
--   · so quem tem `admin.usuarios` mexe nas dos outros;
--   · permissao do modulo ADMINISTRACAO so o ADMIN concede -- senao quem
--     gerencia usuarios daria a outro login o poder de gerenciar, e por
--     ele a si mesmo;
--   · ADMIN tem tudo: excecao nele nao se aplica, e a tela diz isso.
--   · ninguem escreve direto na tabela: so a RPC, que carimba quem mudou.

create table if not exists usuario_permissao (
  usuario_id uuid not null references perfil(id) on delete cascade,
  permissao_chave text not null references permissao(chave) on delete cascade,
  concedida boolean not null,
  definido_por uuid references perfil(id),
  definido_em timestamptz not null default now(),
  primary key (usuario_id, permissao_chave)
);
alter table usuario_permissao enable row level security;
-- Leitura: a propria pessoa (para saber o que tem) e quem administra usuarios.
drop policy if exists usuario_permissao_leitura on usuario_permissao;
create policy usuario_permissao_leitura on usuario_permissao for select to authenticated
  using (usuario_id = (select auth.uid()) or (select tem_permissao('admin.usuarios')));

-- ---- a conta, nas duas funcoes que a fazem ----
create or replace function tem_permissao(p_chave text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuario_papel
                  where usuario_id = auth.uid() and papel = 'ADMIN')
      or coalesce(
           -- 157a: a excecao do login vem primeiro
           (select up.concedida from usuario_permissao up
             where up.usuario_id = auth.uid() and up.permissao_chave = p_chave),
           exists (
             select 1
               from perfil p
               join perfil_acesso_permissao pap on pap.perfil_acesso_id = p.perfil_acesso_id
              where p.id = auth.uid() and pap.permissao_chave = p_chave));
$$;

create or replace function minhas_permissoes()
returns table(chave text, modulo text, rotulo text)
language sql stable security definer set search_path = public as $$
  select pm.chave, pm.modulo, pm.rotulo
    from permissao pm
   where pm.disponivel
     and (
       exists (select 1 from usuario_papel
                where usuario_id = auth.uid() and papel = 'ADMIN')
       or coalesce(
            (select up.concedida from usuario_permissao up
              where up.usuario_id = auth.uid() and up.permissao_chave = pm.chave),
            exists (
              select 1 from perfil p
                join perfil_acesso_permissao pap on pap.perfil_acesso_id = p.perfil_acesso_id
               where p.id = auth.uid() and pap.permissao_chave = pm.chave))
     )
   order by pm.modulo, pm.ordem;
$$;

-- ---- a tela de editar login le por aqui ----
-- `p_perfil`: o perfil escolhido na tela, ainda nao salvo -- o padrao
-- mostrado tem de ser o do perfil que vai valer.
create or replace function permissoes_do_usuario(p_usuario uuid, p_perfil uuid default null)
returns table(chave text, modulo text, rotulo text, descricao text, disponivel boolean,
              do_perfil boolean, excecao boolean, efetiva boolean,
              definido_por text, definido_em timestamptz, alvo_admin boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_perfil uuid; v_admin boolean;
begin
  if not tem_permissao('admin.usuarios') then
    raise exception 'Sem permissao para ver as permissoes de outro login.' using errcode = '42501';
  end if;
  select coalesce(p_perfil, p.perfil_acesso_id) into v_perfil
    from perfil p where p.id = p_usuario and p.empresa_id = minha_empresa();
  if not found then raise exception 'Login nao encontrado.'; end if;
  v_admin := exists (select 1 from usuario_papel where usuario_id = p_usuario and papel = 'ADMIN');

  return query
  select pm.chave, pm.modulo, pm.rotulo, pm.descricao, pm.disponivel,
         exists (select 1 from perfil_acesso_permissao pap
                  where pap.perfil_acesso_id = v_perfil and pap.permissao_chave = pm.chave),
         up.concedida,
         v_admin or coalesce(up.concedida, exists (select 1 from perfil_acesso_permissao pap
                  where pap.perfil_acesso_id = v_perfil and pap.permissao_chave = pm.chave)),
         q.nome, up.definido_em, v_admin
    from permissao pm
    left join usuario_permissao up on up.usuario_id = p_usuario and up.permissao_chave = pm.chave
    left join perfil q on q.id = up.definido_por
   order by pm.modulo, pm.ordem;
end $$;

-- ---- a unica porta de escrita ----
-- `p_alteracoes`: {"chave": true | false | null}. null = volta ao perfil.
create or replace function definir_permissoes_usuario(p_usuario uuid, p_alteracoes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; val jsonb; n_def int := 0; n_tira int := 0;
begin
  if not tem_permissao('admin.usuarios') then
    raise exception 'Sem permissao para mudar permissoes.' using errcode = '42501';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'Ninguem muda as proprias permissoes. Peca a outro administrador.' using errcode = '42501';
  end if;
  if not exists (select 1 from perfil where id = p_usuario and empresa_id = minha_empresa()) then
    raise exception 'Login nao encontrado.';
  end if;

  for k, val in select * from jsonb_each(coalesce(p_alteracoes, '{}'::jsonb)) loop
    if not exists (select 1 from permissao where chave = k) then
      raise exception 'Permissao desconhecida: %', k;
    end if;
    if (select modulo from permissao where chave = k) = 'ADMINISTRACAO'
       and not tem_papel('ADMIN') then
      raise exception 'Permissao de Administracao so o ADMIN concede ou tira (%).', k using errcode = '42501';
    end if;
    if val = 'null'::jsonb then
      delete from usuario_permissao where usuario_id = p_usuario and permissao_chave = k;
      n_tira := n_tira + 1;
    else
      insert into usuario_permissao (usuario_id, permissao_chave, concedida, definido_por, definido_em)
      values (p_usuario, k, (val #>> '{}')::boolean, auth.uid(), now())
      on conflict (usuario_id, permissao_chave)
      do update set concedida = excluded.concedida, definido_por = auth.uid(), definido_em = now();
      n_def := n_def + 1;
    end if;
  end loop;
  return jsonb_build_object('excecoes_gravadas', n_def, 'voltaram_ao_perfil', n_tira);
end $$;

revoke all on function permissoes_do_usuario(uuid, uuid) from public, anon;
revoke all on function definir_permissoes_usuario(uuid, jsonb) from public, anon;
revoke all on function tem_permissao(text) from public, anon;
revoke all on function minhas_permissoes() from public, anon;
grant execute on function permissoes_do_usuario(uuid, uuid) to authenticated;
grant execute on function definir_permissoes_usuario(uuid, jsonb) to authenticated;
grant execute on function tem_permissao(text) to authenticated;
grant execute on function minhas_permissoes() to authenticated;

notify pgrst, 'reload schema';
