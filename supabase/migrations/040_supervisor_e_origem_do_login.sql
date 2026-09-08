-- 040 · O vínculo do supervisor, e de onde veio cada login
--
-- Duas pontas do mesmo assunto: **quem declarou o quê**.

-- ============================================================
-- A · Supervisor ↔ equipes
-- ============================================================
-- `equipe.supervisor_nome` é texto que veio do TOA (85 de 89 equipes,
-- 5 supervisores). `equipe.supervisor_id` é o vínculo com o login, e
-- estava em 0 de 89 — por isso o papel SUPERVISOR entrava e não via
-- nada (D-066).
--
-- Nome não serve de chave: bate por acaso e deixa de bater por acento.
-- Mas serve de FILTRO para o gestor dizer "estas 21 equipes são do Luiz
-- Henrique, e o login dele é este". A declaração continua sendo de quem
-- opera; a função só poupa 21 cliques.
--
-- A função exige que o usuário já tenha o papel SUPERVISOR. Sem o
-- papel, o vínculo não abre nada — e a pessoa acharia que estava feito.

create or replace function definir_supervisor_das_equipes(
  p_usuario uuid, p_supervisor_nome text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare n int; v_nome text;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao para vincular supervisor.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;

  select nome into v_nome from perfil
   where id = p_usuario and empresa_id = minha_empresa();
  if v_nome is null then
    raise exception 'Usuario nao encontrado nesta empresa.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from usuario_papel
                  where usuario_id = p_usuario and papel = 'SUPERVISOR') then
    raise exception 'Este usuario nao tem o papel SUPERVISOR. De o papel antes de vincular.'
      using errcode = '23514';
  end if;

  update equipe
     set supervisor_id = p_usuario
   where empresa_id = minha_empresa()
     and base_id in (select bases_visiveis())
     and norm_txt(supervisor_nome) = norm_txt(p_supervisor_nome);
  get diagnostics n = row_count;

  return jsonb_build_object('usuario', v_nome, 'supervisor', p_supervisor_nome,
                            'equipes', n);
end;
$fn$;

revoke all on function definir_supervisor_das_equipes(uuid, text) from public, anon;
grant execute on function definir_supervisor_das_equipes(uuid, text) to authenticated;

create or replace function limpar_supervisor_das_equipes(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare n int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;
  update equipe set supervisor_id = null
   where supervisor_id = p_usuario and empresa_id = minha_empresa();
  get diagnostics n = row_count;
  return jsonb_build_object('equipes', n);
end;
$fn$;

revoke all on function limpar_supervisor_das_equipes(uuid) from public, anon;
grant execute on function limpar_supervisor_das_equipes(uuid) to authenticated;

create or replace function supervisores_das_equipes()
returns table(supervisor_nome text, equipes bigint, vinculadas bigint,
              usuario_id uuid, usuario_nome text)
language sql stable security definer set search_path to 'public' as $fn$
  select e.supervisor_nome,
         count(*)                          as equipes,
         count(e.supervisor_id)            as vinculadas,
         (array_agg(e.supervisor_id) filter (where e.supervisor_id is not null))[1],
         (array_agg(p.nome)          filter (where p.nome is not null))[1]
    from equipe e
    left join perfil p on p.id = e.supervisor_id
   where e.ativo
     and e.empresa_id = minha_empresa()
     and e.base_id in (select bases_visiveis())
     and e.supervisor_nome is not null
     and eh_gestor()
   group by e.supervisor_nome
   order by 2 desc;
$fn$;

revoke all on function supervisores_das_equipes() from public, anon;
grant execute on function supervisores_das_equipes() to authenticated;

-- ============================================================
-- B · De onde veio o login de cada equipe
-- ============================================================
--
-- ┌─ MOSTRAR O QUE É CADASTRO E O QUE É DEDUZIDO ────────────────────┐
-- │ `equipe_do_login` resolve por três critérios em cascata. Os dois  │
-- │ primeiros são CADASTRO — alguém digitou o login na equipe. O      │
-- │ terceiro sai da planilha de equipes: o login bate com a matrícula │
-- │ do técnico, e o técnico pertence a uma equipe.                    │
-- │                                                                   │
-- │ O terceiro não é palpite, mas é uma FRASE DIFERENTE de "esta      │
-- │ equipe usa o login X". Foi confundir os dois que me levou a       │
-- │ semear cadastro que ninguém cadastrou (D-079).                    │
-- │                                                                   │
-- │ Então a tela passa a dizer por qual critério cada login chegou:   │
-- │ etiqueta CADASTRADO ou PELA MATRÍCULA. Quem lê decide se quer     │
-- │ promover — e aí a declaração é dele, não minha.                   │
-- └───────────────────────────────────────────────────────────────────┘

create or replace function logins_das_equipes(p_data date default current_date)
returns table(equipe_id uuid, login text, origem text, visitas bigint)
language sql stable security definer set search_path to 'public' as $fn$
  with vis as (
    select v.base_id, v.equipe_id,
           nullif(btrim(coalesce(v.dados_origem->>'Login do Técnico','')),'') as login,
           count(*) as visitas
      from visita v
     where v.excluido_em is null
       and v.data_agendada = p_data
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
     group by 1, 2, 3
  )
  select vis.equipe_id, vis.login,
         case
           when exists (select 1 from equipe_login_toa h
                         join equipe e on e.id = h.equipe_id
                        where e.base_id = vis.base_id
                          and norm_txt(h.login_toa) = norm_txt(vis.login)
                          and h.inicio <= p_data
                          and (h.fim is null or h.fim >= p_data))
             then 'CADASTRO'
           when exists (select 1 from equipe e
                        where e.base_id = vis.base_id
                          and norm_txt(e.login_toa) = norm_txt(vis.login))
             then 'CADASTRO'
           when exists (select 1 from tecnico t
                        where t.base_id = vis.base_id
                          and norm_txt(t.matricula) = norm_txt(vis.login)
                          and t.equipe_id is not null)
             then 'MATRICULA'
           else 'SEM_CADASTRO'
         end as origem,
         vis.visitas
    from vis
   where vis.login is not null;
$fn$;

revoke all on function logins_das_equipes(date) from public, anon;
grant execute on function logins_das_equipes(date) to authenticated;

-- Promove a dedução a cadastro, quando o gestor confirma. Uma equipe por
-- vez, e com autor: é assim que dedução vira declaração.
create or replace function cadastrar_login_da_equipe(
  p_equipe uuid, p_login text, p_desde date default current_date)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_cod text; v_base uuid;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_login,'')),'') is null then
    raise exception 'Informe o login.' using errcode = '23514';
  end if;

  select codigo, base_id into v_cod, v_base from equipe
   where id = p_equipe and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if v_cod is null then
    raise exception 'Equipe nao encontrada.' using errcode = 'P0002';
  end if;

  -- Um login não pode estar aberto em duas equipes: fecha o anterior.
  update equipe_login_toa set fim = p_desde - 1
   where norm_txt(login_toa) = norm_txt(p_login) and fim is null
     and equipe_id <> p_equipe;
  update equipe set login_toa = null
   where base_id = v_base and norm_txt(login_toa) = norm_txt(p_login)
     and id <> p_equipe;

  update equipe set login_toa = btrim(p_login) where id = p_equipe;

  insert into equipe_login_toa (equipe_id, login_toa, inicio, criado_por)
  select p_equipe, btrim(p_login), p_desde, auth.uid()
   where not exists (select 1 from equipe_login_toa
                      where equipe_id = p_equipe
                        and norm_txt(login_toa) = norm_txt(p_login)
                        and fim is null);

  return jsonb_build_object('equipe', v_cod, 'login', btrim(p_login), 'desde', p_desde);
end;
$fn$;

revoke all on function cadastrar_login_da_equipe(uuid, text, date) from public, anon;
grant execute on function cadastrar_login_da_equipe(uuid, text, date) to authenticated;

-- Medido em 07/09, no dia com serviço: 6 equipes resolvem PELA MATRÍCULA
-- (45 visitas) e 1 por CADASTRO (7 visitas).
