-- 042 · Só o cadastro roteia
--
-- ┌─ O QUE O EMANUEL PEGOU ──────────────────────────────────────────┐
-- │ "Está jogando para equipes que eu nem disse que o login x é da    │
-- │  equipe x. Os contratos deveriam ir para a equipe 'Sem login      │
-- │  definido'. O usuário, ao cadastrar, vai dizer: login tal é do    │
-- │  Fernando, vai para equipe X."                                     │
-- └───────────────────────────────────────────────────────────────────┘
--
-- `equipe_do_login` tinha três critérios. O terceiro — casar o login
-- com a **matrícula** do técnico e usar a equipe dele — mandava contrato
-- para equipe que ninguém tinha declarado.
--
-- Deduzir a equipe pela matrícula parecia inofensivo porque acerta na
-- maioria das vezes. Mas acertar por conta própria é exatamente o que
-- faz ninguém perceber quando erra. E revoga D-082, que eu tinha
-- decidido no lugar dele — a decisão era dele desde o começo.
--
-- ⚠ Isto REVOGA o critério 3 do D-082. A matrícula do técnico diz de
--   QUEM é o login, não de qual EQUIPE ele é — são perguntas diferentes.

create or replace function equipe_do_login(
  p_base uuid, p_login text, p_data date default current_date)
returns uuid language sql stable set search_path to 'public' as $function$
  select case when nullif(btrim(coalesce(p_login, '')), '') is null then null
  else (
    select eq from (
      -- 1. o cadastro com período (o login muda de dono com o tempo)
      (select e.id as eq, 1 as ordem
         from equipe_login_toa h
         join equipe e on e.id = h.equipe_id
        where e.base_id = p_base
          and nullif(btrim(coalesce(h.login_toa, '')), '') is not null
          and norm_txt(h.login_toa) = norm_txt(p_login)
          and h.inicio <= p_data and (h.fim is null or h.fim >= p_data)
        limit 1)
      union all
      -- 2. o login corrente da equipe
      (select e.id, 2
         from equipe e
        where e.base_id = p_base
          and nullif(btrim(coalesce(e.login_toa, '')), '') is not null
          and norm_txt(e.login_toa) = norm_txt(p_login)
        limit 1)
    ) c order by ordem limit 1)
  end;
$function$;

revoke all on function equipe_do_login(uuid, text, date) from public, anon;

-- A equipe abrigo volta, com o nome que o Emanuel deu.
insert into equipe (base_id, codigo, nome, ativo, empresa_id, supervisor_nome)
select b.id, 'SEM-LOGIN', 'Sem login definido', true, b.empresa_id, null
  from base b
 where not exists (select 1 from equipe e
                    where e.base_id = b.id and e.codigo = 'SEM-LOGIN');

update equipe set nome = 'Sem login definido' where codigo = 'SEM-LOGIN';

create or replace function equipe_abrigo(p_base uuid)
returns uuid language sql stable set search_path to 'public' as $fn$
  select id from equipe where base_id = p_base and codigo = 'SEM-LOGIN' limit 1;
$fn$;

revoke all on function equipe_abrigo(uuid) from public, anon;

-- "Para onde vai este contrato" — pergunta diferente de "de quem é este
-- login". Login cadastrado vai para a equipe; login sem cadastro vai
-- para o abrigo, onde incomoda até alguém cadastrar; sem login
-- (jornada) não vai para lugar nenhum, porque não há o que declarar.
create or replace function equipe_do_contrato(
  p_base uuid, p_login text, p_data date default current_date)
returns uuid language sql stable set search_path to 'public' as $fn$
  select case
    when nullif(btrim(coalesce(p_login, '')), '') is null then null
    else coalesce(equipe_do_login(p_base, p_login, p_data),
                  equipe_abrigo(p_base))
  end;
$fn$;

revoke all on function equipe_do_contrato(uuid, text, date) from public, anon;

do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';
  novo := replace(src,
    'v_equipe  := equipe_do_login(v_base, v_login, v_data);',
    'v_equipe  := equipe_do_contrato(v_base, v_login, v_data);');
  if novo = src then
    raise exception 'Nao achei a chamada a equipe_do_login no importador.';
  end if;
  execute novo;
end $$;

revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

-- ============================================================
-- A tela para o usuário declarar
-- ============================================================
-- Traz o nome do técnico e a equipe dele como SUGESTÃO — a planilha de
-- equipes sabe quem é a pessoa —, mas não roteia nada por conta própria.
create or replace function logins_sem_cadastro(
  p_de date default null, p_ate date default null)
returns table(
  login text, visitas bigint, primeira date, ultima date,
  tecnico_nome text, equipe_sugerida_id uuid, equipe_sugerida text)
language sql stable security definer set search_path to 'public' as $fn$
  with v as (
    select v.base_id,
           nullif(btrim(coalesce(v.dados_origem->>'Login do Técnico','')),'') as login,
           v.data_agendada
      from visita v
     where v.excluido_em is null
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and eh_gestor()
       and (p_de  is null or v.data_agendada >= p_de)
       and (p_ate is null or v.data_agendada <= p_ate)
  ),
  ag as (
    select v.login, v.base_id, count(*) as visitas,
           min(v.data_agendada) as primeira, max(v.data_agendada) as ultima
      from v
     where v.login is not null
       and equipe_do_login(v.base_id, v.login, v.data_agendada) is null
     group by 1, 2
  )
  select ag.login, ag.visitas, ag.primeira, ag.ultima,
         t.nome, t.equipe_id, e.codigo
    from ag
    left join tecnico t on t.base_id = ag.base_id
                       and norm_txt(t.matricula) = norm_txt(ag.login)
    left join equipe  e on e.id = t.equipe_id and e.codigo <> 'SEM-LOGIN'
   order by ag.visitas desc;
$fn$;

revoke all on function logins_sem_cadastro(date, date) from public, anon;
grant execute on function logins_sem_cadastro(date, date) to authenticated;

-- Cadastrar o login tem de LEVAR OS CONTRATOS junto. Sem isso o usuário
-- cadastra, vê a etiqueta mudar e continua com 337 contratos no abrigo —
-- e conclui, com razão, que o cadastro não serviu para nada.
--
-- Vale desde a PRIMEIRA visita daquele login, não desde hoje: senão o
-- histórico já importado continua órfão.
create or replace function cadastrar_login_da_equipe(
  p_equipe uuid, p_login text, p_desde date default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare v_cod text; v_base uuid; v_desde date; n int;
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
  if v_cod = 'SEM-LOGIN' then
    raise exception 'A equipe abrigo nao recebe cadastro de login.'
      using errcode = '23514';
  end if;

  select coalesce(p_desde, min(v.data_agendada), current_date)
    into v_desde
    from visita v
   where v.base_id = v_base and v.excluido_em is null
     and norm_txt(v.dados_origem->>'Login do Técnico') = norm_txt(p_login);

  update equipe_login_toa set fim = greatest(v_desde - 1, inicio)
   where norm_txt(login_toa) = norm_txt(p_login) and fim is null
     and equipe_id <> p_equipe;
  update equipe set login_toa = null
   where base_id = v_base and norm_txt(login_toa) = norm_txt(p_login)
     and id <> p_equipe;

  update equipe set login_toa = btrim(p_login) where id = p_equipe;

  insert into equipe_login_toa (equipe_id, login_toa, inicio, criado_por)
  select p_equipe, btrim(p_login), v_desde, auth.uid()
   where not exists (select 1 from equipe_login_toa
                      where equipe_id = p_equipe
                        and norm_txt(login_toa) = norm_txt(p_login)
                        and fim is null);

  insert into visita_evento (visita_id, tipo, de, para, origem,
                             usuario_id, login, observacao)
  select v.id, 'TRANSFERENCIA',
         jsonb_build_object('equipe', (select codigo from equipe where id = v.equipe_id)),
         jsonb_build_object('equipe', v_cod),
         'WEB', auth.uid(), btrim(p_login),
         'Login cadastrado na equipe'
    from visita v
   where v.base_id = v_base and v.excluido_em is null
     and norm_txt(v.dados_origem->>'Login do Técnico') = norm_txt(p_login)
     and v.data_agendada >= v_desde
     and v.equipe_id is distinct from p_equipe;

  update visita v set equipe_id = p_equipe
   where v.base_id = v_base and v.excluido_em is null
     and norm_txt(v.dados_origem->>'Login do Técnico') = norm_txt(p_login)
     and v.data_agendada >= v_desde
     and v.equipe_id is distinct from p_equipe;
  get diagnostics n = row_count;

  return jsonb_build_object('equipe', v_cod, 'login', btrim(p_login),
                            'desde', v_desde, 'contratos_movidos', n);
end;
$fn$;

revoke all on function cadastrar_login_da_equipe(uuid, text, date) from public, anon;
grant execute on function cadastrar_login_da_equipe(uuid, text, date) to authenticated;

-- `logins_das_equipes` não pode mais dizer "PELA MATRÍCULA": a matrícula
-- deixou de rotear. Ou o login está cadastrado, ou não está.
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
         case when equipe_do_login(vis.base_id, vis.login, p_data) is not null
              then 'CADASTRO' else 'SEM_CADASTRO' end,
         vis.visitas
    from vis
   where vis.login is not null;
$fn$;

revoke all on function logins_das_equipes(date) from public, anon;
grant execute on function logins_das_equipes(date) to authenticated;

-- ============================================================
-- Onde ficou tudo, depois de realinhar
-- ============================================================
--   Sem login definido (abrigo) ...... 337 visitas · 46 logins
--   Em equipe cadastrada ............. 121 visitas ·  9 logins
--   Sem equipe (jornada, sem login) .. 159 visitas
--
-- Testado e desfeito: cadastrar Z125771 na equipe 064 moveu 16
-- contratos do abrigo para a 064, com 16 eventos, valendo desde
-- 04/09 — a primeira visita daquele login.
