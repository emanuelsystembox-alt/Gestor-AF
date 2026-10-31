-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 160b · CPF e RG gravados: só o administrador principal altera    ║
-- ║        e os dados obrigatórios não se apagam                     ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "Os dados criados de CPF e RG, ninguem pode editar. Somente o e-mail
-- >  de login ADM, que e o meu. (...) O restante, os outros, podem editar
-- >  normalmente, desde que esteja as permissoes."
-- > "para todos os campos sensiveis como nascimento, WhatsApp, CPF, RG,
-- >  matricula, data de contratacao terao que ser obrigatorios daqui para
-- >  frente. Isso e uma trava do sistema"  -- Emanuel, 31/10
--
-- ┌─ quem e "o administrador principal" ──────────────────────────────┐
-- │ O login admin@afline.com.br (Emanuel). NAO e "qualquer ADMIN": ha  │
-- │ tres, e ele pediu o dele. A identidade mora AQUI, numa funcao que  │
-- │ so uma migration troca -- nao num parametro que um ADMIN editaria  │
-- │ pela tela, porque entao qualquer ADMIN se poria no lugar.          │
-- └────────────────────────────────────────────────────────────────────┘
--
-- "Obrigatorio daqui para frente" vale no CADASTRO NOVO (a Edge Function
-- `admin-usuarios` recusa criar login sem os seis). Nao vale para editar
-- quem ja existe: medido em 31/10, dos 89 logins ativos, 86 nao tem data
-- de contratacao e 16 nao tem matricula do ponto -- exigir na edicao
-- travaria quase toda alteracao. O que vale para todos: dado preenchido
-- nao se APAGA.
--
-- Conexao de servico (auth.uid() nulo: migration, service_role) passa,
-- como no gatilho da 103: travar ali so quebraria manutencao.

create or replace function editor_dados_sensiveis() returns uuid
language sql immutable set search_path = public as $$
  select '3f3da7f6-7a52-431e-894b-e333fcff7749'::uuid   -- admin@afline.com.br
$$;

-- A tela pergunta para saber se abre o CPF/RG para edicao.
create or replace function posso_editar_documentos() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = editor_dados_sensiveis();
$$;

create or replace function perfil_trava_documentos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if auth.uid() <> editor_dados_sensiveis() and (
       (nullif(btrim(old.cpf), '') is not null and new.cpf is distinct from old.cpf)
    or (nullif(btrim(old.rg), '')  is not null and new.rg  is distinct from old.rg)) then
    raise exception 'CPF e RG, depois de gravados, so o administrador principal altera.'
      using errcode = '42501';
  end if;

  if (nullif(btrim(old.whatsapp), '') is not null and nullif(btrim(new.whatsapp), '') is null)
  or (nullif(btrim(old.cpf), '') is not null and nullif(btrim(new.cpf), '') is null)
  or (nullif(btrim(old.rg), '') is not null and nullif(btrim(new.rg), '') is null)
  or (old.data_nascimento is not null and new.data_nascimento is null)
  or (nullif(btrim(old.matricula_ponto), '') is not null and nullif(btrim(new.matricula_ponto), '') is null)
  or (old.data_contratacao is not null and new.data_contratacao is null) then
    raise exception 'Dado obrigatorio nao se apaga (WhatsApp, CPF, RG, nascimento, matricula do ponto, data de contratacao).'
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists trg_perfil_trava_documentos on perfil;
create trigger trg_perfil_trava_documentos before update on perfil
  for each row execute function perfil_trava_documentos();

revoke all on function editor_dados_sensiveis() from public, anon;
revoke all on function posso_editar_documentos() from public, anon;
revoke all on function perfil_trava_documentos() from public, anon;
grant execute on function editor_dados_sensiveis() to authenticated;
grant execute on function posso_editar_documentos() to authenticated;

notify pgrst, 'reload schema';
