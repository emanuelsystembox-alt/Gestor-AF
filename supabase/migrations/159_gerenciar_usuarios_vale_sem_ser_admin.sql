-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 159 · "Gerenciar usuários" passa a valer para quem não é ADMIN   ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "concedi o renan cargo para mexer e editar os dados do administrador
-- >  porem ele ainda nao consegue por que? ja liberei na permissao"
-- >  -- Emanuel, 31/10
--
-- ┌─ o defeito ────────────────────────────────────────────────────────┐
-- │ A administracao de usuarios foi construida em cima do PAPEL ADMIN: │
-- │ as policies de escrita de `perfil`, `usuario_papel`, `usuario_base`,│
-- │ o gatilho que protege as colunas do perfil, `definir_papeis`, a    │
-- │ foto, a Edge Function que cria login e troca senha -- e o botao    │
-- │ Editar da tela. A permissao `admin.usuarios` so abria a tela de    │
-- │ permissoes (157). O Renan tinha a caixa marcada e nada funcionava. │
-- │ E a coluna "Papeis" dizia "sem papel" para todo mundo, porque ele  │
-- │ nao podia LER os papeis dos outros: desconhecido virando zero.     │
-- └────────────────────────────────────────────────────────────────────┘
--
-- O modelo: quem tem `admin.usuarios` gerencia os logins
--   · da propria empresa,
--   · das cidades que ele acessa (`bases_permitidas`),
--   · que NAO sao ADMIN,
--   · e nao o proprio (o que e pessoal ele ja edita pela autoedicao).
-- E nunca entrega o que o faria ADMIN por tabela:
--   · o papel ADMIN, so o ADMIN da;
--   · perfil de acesso que contenha permissao do modulo Administracao, so
--     o ADMIN atribui (a mesma trava da 157a para as excecoes);
--   · e-mail e empresa continuam so do ADMIN.
-- Sem isso, "gerenciar usuarios" seria um ADMIN com outro nome: trocar a
-- senha do ADMIN e entrar como ele.

-- ---- a conta, num lugar so ----
create or replace function pode_gerir_usuario(p_alvo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when tem_papel('ADMIN') then
      exists (select 1 from perfil where id = p_alvo and empresa_id = minha_empresa())
    when not tem_permissao('admin.usuarios') then false
    else exists (
      select 1 from perfil p
       where p.id = p_alvo
         and p.empresa_id = minha_empresa()
         and p.id <> auth.uid()
         and not exists (select 1 from usuario_papel up
                          where up.usuario_id = p.id and up.papel = 'ADMIN')
         and (p.base_id is null or p.base_id in (select bases_permitidas())))
  end;
$$;

-- Perfil de acesso que entrega poder de Administracao.
create or replace function perfil_acesso_administra(p_perfil uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfil_acesso_permissao pap
                   join permissao pm on pm.chave = pap.permissao_chave
                  where pap.perfil_acesso_id = p_perfil and pm.modulo = 'ADMINISTRACAO');
$$;

-- A Edge Function `admin-usuarios` pergunta aqui, COM O JWT de quem chamou,
-- antes de criar um login. Nulo = pode; texto = o motivo da recusa.
create or replace function pode_criar_usuario(p_base uuid, p_perfil uuid, p_papel text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if tem_papel('ADMIN') then return null; end if;
  if not tem_permissao('admin.usuarios') then
    return 'Seu perfil nao inclui "Gerenciar usuarios".';
  end if;
  if upper(coalesce(p_papel, '')) = 'ADMIN'
     or (p_perfil is not null and exists (select 1 from perfil_acesso
                                           where id = p_perfil and papel::text = 'ADMIN')) then
    return 'O papel ADMIN so o ADMIN da.';
  end if;
  if p_perfil is not null and perfil_acesso_administra(p_perfil) then
    return 'Este perfil de acesso da poder de Administracao: so o ADMIN atribui.';
  end if;
  if p_base is null or p_base not in (select bases_permitidas()) then
    return 'Escolha uma das cidades que voce acessa.';
  end if;
  return null;
end $$;

-- ---- as colunas protegidas do perfil ----
create or replace function perfil_protege_campos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em := now();

  -- 106: base ou cidade ativa mudou -> recalcular bases_visiveis().
  if new.base_id is distinct from old.base_id
  or new.base_ativa is distinct from old.base_ativa then
    perform set_config('app.bases_visiveis', '', true);
  end if;

  -- Sem auth.uid() = conexao de servico (migration, service_role, o
  -- proprio postgres). Essa ja pode tudo pela porta da frente; travar
  -- aqui so quebraria manutencao, sem fechar buraco nenhum.
  if auth.uid() is null or tem_papel('ADMIN') then
    return new;
  end if;

  -- 159: quem gerencia usuarios mexe no cadastro de OUTRO login que
  -- pode gerir -- menos empresa e e-mail, e sem entregar Administracao.
  if new.id <> auth.uid() and pode_gerir_usuario(old.id) then
    if new.empresa_id is distinct from old.empresa_id
    or new.email      is distinct from old.email then
      raise exception 'Empresa e e-mail so o ADMIN altera.' using errcode = '42501';
    end if;
    if new.base_id is distinct from old.base_id
       and (new.base_id is null or new.base_id not in (select bases_permitidas())) then
      raise exception 'Escolha uma das cidades que voce acessa.' using errcode = '42501';
    end if;
    if new.perfil_acesso_id is distinct from old.perfil_acesso_id
       and new.perfil_acesso_id is not null
       and perfil_acesso_administra(new.perfil_acesso_id) then
      raise exception 'Este perfil de acesso da poder de Administracao: so o ADMIN atribui.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.empresa_id       is distinct from old.empresa_id
  or new.base_id          is distinct from old.base_id
  or new.ativo            is distinct from old.ativo
  or new.perfil_acesso_id is distinct from old.perfil_acesso_id
  or new.cargo_id         is distinct from old.cargo_id
  or new.tecnico_id       is distinct from old.tecnico_id
  or new.email            is distinct from old.email
  -- 101: a data de contratação é registro da empresa, não da pessoa.
  or new.data_contratacao is distinct from old.data_contratacao
  -- 103: a foto é posta pelo ADMIN, no cadastro (D-180).
  or new.foto_path        is distinct from old.foto_path then
    raise exception
      'Empresa, base, situacao, cargo, perfil de acesso, e-mail, data de contratacao e foto so quem gerencia usuarios altera.'
      using errcode = '42501';
  end if;

  -- 103: a cidade ativa a pessoa escolhe, mas só entre as que pode ver.
  if new.base_ativa is distinct from old.base_ativa
     and new.base_ativa is not null
     and new.base_ativa not in (select bases_permitidas()) then
    raise exception 'Voce nao tem acesso a esta cidade.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---- policies ----
drop policy if exists perfil_gestao_usuarios on perfil;
create policy perfil_gestao_usuarios on perfil for update to authenticated
  using ((select tem_permissao('admin.usuarios')) and pode_gerir_usuario(id))
  with check ((select tem_permissao('admin.usuarios')) and pode_gerir_usuario(id));

-- Ler: quem gerencia usuarios precisa ver os logins (o supervisor nao via).
alter policy perfil_leitura on perfil using (
  (id = (select auth.uid()))
  or ((empresa_id = (select minha_empresa()))
      and ((select eh_gestor()) or (select tem_papel('CONTROLADOR'))
           or (select tem_permissao('admin.usuarios')))));

-- Os papeis e as cidades dos outros: sem ler, a tela escrevia "sem papel".
alter policy papel_leitura on usuario_papel using (
  (usuario_id = (select auth.uid())) or (select eh_gestor())
  or (select tem_permissao('admin.usuarios')));

alter policy ub_leitura on usuario_base using (
  (usuario_id = (select auth.uid())) or (select eh_gestor())
  or (select tem_permissao('admin.usuarios')));

drop policy if exists ub_gestao_usuarios on usuario_base;
create policy ub_gestao_usuarios on usuario_base for all to authenticated
  using ((select tem_permissao('admin.usuarios')) and pode_gerir_usuario(usuario_id)
         and base_id in (select bases_permitidas()))
  with check ((select tem_permissao('admin.usuarios')) and pode_gerir_usuario(usuario_id)
         and base_id in (select bases_permitidas()));

-- ---- a foto ----
alter policy foto_perfil_enviar on storage.objects with check (
  bucket_id = 'foto_perfil' and usuario_do_path(name) is not null
  and ((select tem_papel('ADMIN')) or pode_gerir_usuario(usuario_do_path(name))));
alter policy foto_perfil_trocar on storage.objects
  using (bucket_id = 'foto_perfil'
         and ((select tem_papel('ADMIN')) or pode_gerir_usuario(usuario_do_path(name))))
  with check (bucket_id = 'foto_perfil' and usuario_do_path(name) is not null
         and ((select tem_papel('ADMIN')) or pode_gerir_usuario(usuario_do_path(name))));
alter policy foto_perfil_remover on storage.objects using (
  bucket_id = 'foto_perfil'
  and ((select tem_papel('ADMIN')) or pode_gerir_usuario(usuario_do_path(name))));

-- ---- definir_papeis ----
do $$
declare d text; antes text;
begin
  d := pg_get_functiondef('definir_papeis(uuid, text[])'::regprocedure); antes := d;
  d := replace(d,
    E'  if not tem_papel(\'ADMIN\') then\n    raise exception \'Sem permissao.\' using errcode = \'42501\';\n  end if;',
    E'  -- 159: quem gerencia usuarios tambem define papeis -- de quem pode\n' ||
    E'  -- gerir, e nunca o papel ADMIN.\n' ||
    E'  if not (tem_papel(\'ADMIN\') or pode_gerir_usuario(p_usuario)) then\n' ||
    E'    raise exception \'Sem permissao.\' using errcode = \'42501\';\n  end if;\n' ||
    E'  if not tem_papel(\'ADMIN\') and \'ADMIN\' = any(p_papeis) then\n' ||
    E'    raise exception \'O papel ADMIN so o ADMIN da.\' using errcode = \'42501\';\n  end if;');
  if d = antes then raise exception '159: trava de definir_papeis nao achada'; end if;
  execute d;
end $$;

-- ---- as RPCs de equipe e tecnico do Editar cadastro ----
-- A trava de papel era `eh_gestor()` (ADMIN/COP); a permissao, logo abaixo,
-- ja decidia. Vira "e da gestao" -- o mesmo modelo da 158b.
do $$
declare f text; d text; antes text;
begin
  foreach f in array array['definir_supervisor_das_equipes','definir_tecnicos_do_supervisor',
                           'limpar_supervisor_das_equipes','definir_skill_tecnico',
                           'vincular_tecnico_ao_usuario'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := replace(d, 'if not eh_gestor() then', 'if not eh_gestao() then');
    if d = antes then raise exception '159: trava nao achada em %', f; end if;
    execute d;
  end loop;
  -- Estas duas nao conferiam permissao nenhuma: o COP continua passando
  -- pelo papel, e a gestao passa com a chave de equipe ou de usuarios.
  foreach f in array array['cadastrar_tecnico_avulso','criar_equipe_do_supervisor'] loop
    d := pg_get_functiondef(f::regproc); antes := d;
    d := replace(d, 'if not eh_gestor() then',
      'if not (eh_gestor() or (eh_gestao() and (tem_permissao(''equipes.editar'') or tem_permissao(''admin.usuarios'')))) then');
    if d = antes then raise exception '159: trava nao achada em %', f; end if;
    execute d;
  end loop;
end $$;

-- ---- as excecoes de permissao (157a) so de quem ele pode gerir ----
-- Antes: qualquer login da empresa, inclusive de outra cidade.
do $$
declare d text; antes text;
begin
  d := pg_get_functiondef('definir_permissoes_usuario(uuid, jsonb)'::regprocedure); antes := d;
  d := replace(d,
    E'  if not exists (select 1 from perfil where id = p_usuario and empresa_id = minha_empresa()) then\n    raise exception \'Login nao encontrado.\';\n  end if;',
    E'  if not pode_gerir_usuario(p_usuario) then\n' ||
    E'    raise exception \'Este login esta fora do que voce gerencia (ADMIN, outra cidade ou outra empresa).\' using errcode = \'42501\';\n  end if;');
  if d = antes then raise exception '159: trava de definir_permissoes_usuario nao achada'; end if;
  execute d;
end $$;

revoke all on function pode_gerir_usuario(uuid) from public, anon;
revoke all on function perfil_acesso_administra(uuid) from public, anon;
revoke all on function pode_criar_usuario(uuid, uuid, text) from public, anon;
grant execute on function pode_gerir_usuario(uuid) to authenticated;
grant execute on function perfil_acesso_administra(uuid) to authenticated;
grant execute on function pode_criar_usuario(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
