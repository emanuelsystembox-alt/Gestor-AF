-- 041 · O Login TOA no cadastro de acesso
--
-- ┌─ A PEÇA QUE FALTAVA ENTRE O LOGIN E O TÉCNICO ───────────────────┐
-- │ Criar o acesso não bastava: `tecnico.usuario_id` continuava nulo, │
-- │ e é ele que o RLS consulta (`meu_tecnico_id`, `equipes_visiveis`) │
-- │ para saber qual agenda a pessoa enxerga. Sem o vínculo, o técnico │
-- │ entrava no app e via a tela vazia — e ninguém sabia por quê.      │
-- │                                                                   │
-- │ O elo é o LOGIN DO TOA, que é a matrícula do técnico: o mesmo     │
-- │ valor que a importação usa para rotear o contrato. Pedi-lo na     │
-- │ hora de criar o acesso é pedir a coisa certa no momento certo.    │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A tela de Administração ganhou o campo "Login TOA (matrícula do
-- técnico)". Depois de a Edge Function criar o acesso, o front chama
-- esta função com o `usuario_id` devolvido. Se o vínculo falhar, o
-- recado diz as DUAS coisas — acesso criado, vínculo não — para ninguém
-- criar o usuário de novo achando que nada aconteceu.

create or replace function vincular_tecnico_ao_usuario(
  p_usuario uuid, p_login_toa text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v record; v_dono text;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao para vincular tecnico.' using errcode = '42501';
  end if;
  if not tem_permissao('admin.usuarios') then
    raise exception 'Seu perfil de acesso nao inclui "Gerenciar usuarios".'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_login_toa,'')),'') is null then
    raise exception 'Informe o login do TOA.' using errcode = '23514';
  end if;

  perform 1 from perfil where id = p_usuario and empresa_id = minha_empresa();
  if not found then
    raise exception 'Usuario nao encontrado nesta empresa.' using errcode = 'P0002';
  end if;

  select t.id, t.nome, t.matricula, t.usuario_id, e.codigo as equipe
    into v
    from tecnico t
    left join equipe e on e.id = t.equipe_id
   where t.base_id in (select bases_visiveis())
     and norm_txt(t.matricula) = norm_txt(p_login_toa)
   limit 1;

  if v.id is null then
    raise exception
      'Nao existe tecnico com o login %. Importe a planilha de equipes antes, ou confira o login.',
      btrim(p_login_toa) using errcode = 'P0002';
  end if;

  -- Um técnico só pode ter um login. Dois acessos para a mesma pessoa
  -- fariam a produtividade dela contar em dois lugares.
  if v.usuario_id is not null and v.usuario_id <> p_usuario then
    select nome into v_dono from perfil where id = v.usuario_id;
    raise exception 'O tecnico % ja esta vinculado ao acesso de %.',
      v.matricula, coalesce(v_dono, 'outro usuario') using errcode = '23505';
  end if;

  -- E um acesso só responde por um técnico: solta o anterior, se houver.
  update tecnico set usuario_id = null
   where usuario_id = p_usuario and id <> v.id;

  update tecnico set usuario_id = p_usuario where id = v.id;
  update perfil  set tecnico_id = v.id      where id = p_usuario;

  return jsonb_build_object('tecnico', v.nome, 'matricula', v.matricula,
                            'equipe', v.equipe);
end;
$fn$;

revoke all on function vincular_tecnico_ao_usuario(uuid, text) from public, anon;
grant execute on function vincular_tecnico_ao_usuario(uuid, text) to authenticated;

create or replace function desvincular_tecnico_do_usuario(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare n int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('admin.usuarios') then
    raise exception 'Seu perfil de acesso nao inclui "Gerenciar usuarios".'
      using errcode = '42501';
  end if;

  update tecnico set usuario_id = null where usuario_id = p_usuario;
  get diagnostics n = row_count;
  update perfil set tecnico_id = null where id = p_usuario;
  return jsonb_build_object('desvinculados', n);
end;
$fn$;

revoke all on function desvincular_tecnico_do_usuario(uuid) from public, anon;
grant execute on function desvincular_tecnico_do_usuario(uuid) to authenticated;

-- Testado com usuário temporário, e desfeito:
--   login existente ........ {"equipe":"033","tecnico":"ODSON FRANK…","matricula":"Z674378"}
--   login inexistente ...... barrado, dizendo para importar a planilha de equipes
--   técnico já vinculado ... barrado, nomeando o dono do outro acesso
--   gravou o vínculo ....... tecnico.usuario_id = true
--   desvinculou ............ usuario_id nulo = true
