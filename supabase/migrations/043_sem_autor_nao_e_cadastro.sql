-- 043 · Sem autor não é cadastro · o técnico se desliga, não se apaga
--
-- ┌─ O QUE O EMANUEL PEGOU ──────────────────────────────────────────┐
-- │ "A sugestão não quero que apareça, todos sabem que precisa ter    │
-- │  cadastro. Outra coisa: por que tem 1 técnico que tem os          │
-- │  contratos na equipe? Eu não cadastrei nenhum usuário ainda."     │
-- │                                                                    │
-- │ "Quando um técnico for desligado da empresa, o usuário não vai    │
-- │  poder apagar ele, somente o admin, só pode aparecer o botão      │
-- │  desativar — não podemos perder o histórico de contratos          │
-- │  executados da equipe, tudo precisa ficar gravado."               │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A 039 apagou os 45 cadastros que EU tinha deduzido e preservou 9 —
-- "as que já estavam lá em 06/09". Só que essas 9 também não foram
-- digitadas por ninguém: `equipe_login_toa` mostra as nove com o MESMO
-- `criado_em` (2026-09-06 04:06:04.121795) e `criado_por` NULO. É seed
-- de migration, não declaração. A única linha com autor é a
-- 027 · Z428441, cadastrada pelo Emanuel na tela em 08/09.
--
-- A lição que faltava: "estava lá antes" não é prova de cadastro.
-- Prova de cadastro é ter AUTOR. Por isso o autor vira critério, e não
-- só carimbo de auditoria — assim nenhum seed futuro se passa por
-- declaração.

-- ============================================================
-- A · Só cadastro com autor roteia
-- ============================================================
-- Some junto o critério 2 (`equipe.login_toa` solto). A coluna não
-- guarda quem disse nem desde quando — qualquer rotina que a preencha
-- passaria a rotear contrato calada, que é o defeito que a 042 tirou
-- pela porta da matrícula. Ela continua existindo, para a tela mostrar
-- o login corrente da equipe; deixa é de decidir.
create or replace function equipe_do_login(
  p_base uuid, p_login text, p_data date default current_date)
returns uuid language sql stable set search_path to 'public' as $function$
  select case when nullif(btrim(coalesce(p_login, '')), '') is null then null
  else (
    select e.id
      from equipe_login_toa h
      join equipe e on e.id = h.equipe_id
     where e.base_id = p_base
       and h.criado_por is not null
       and nullif(btrim(coalesce(h.login_toa, '')), '') is not null
       and norm_txt(h.login_toa) = norm_txt(p_login)
       and h.inicio <= p_data and (h.fim is null or h.fim >= p_data)
     order by h.inicio desc
     limit 1)
  end;
$function$;

revoke all on function equipe_do_login(uuid, text, date) from public, anon;

-- ============================================================
-- B · Desfazer o que os 9 seeds rotearam
-- ============================================================
-- 121 contratos estão em equipe por causa deles. Voltam para o abrigo,
-- com evento — ninguém descobre depois que a equipe mudou sozinha.
do $$
declare n_ev int; n_vis int; n_cad int;
begin
  insert into visita_evento (visita_id, tipo, de, para, origem, login, observacao)
  select v.id, 'TRANSFERENCIA',
         jsonb_build_object('equipe', e.codigo),
         jsonb_build_object('equipe', 'SEM-LOGIN'),
         'SISTEMA', h.login_toa,
         'Cadastro de login sem autor desfeito (043) — ninguém declarou este login'
    from equipe_login_toa h
    join equipe e on e.id = h.equipe_id
    join visita v on v.equipe_id = e.id and v.excluido_em is null
   where h.criado_por is null;
  get diagnostics n_ev = row_count;

  update visita v
     set equipe_id = equipe_abrigo(v.base_id)
    from equipe_login_toa h
   where h.criado_por is null
     and v.equipe_id = h.equipe_id
     and v.excluido_em is null;
  get diagnostics n_vis = row_count;

  update equipe e set login_toa = null
    from equipe_login_toa h
   where h.criado_por is null and h.equipe_id = e.id;

  delete from equipe_login_toa where criado_por is null;
  get diagnostics n_cad = row_count;

  raise notice '043: % cadastros sem autor removidos, % contratos ao abrigo, % eventos.',
    n_cad, n_vis, n_ev;
end $$;

-- Daqui em diante, cadastro sem autor nem entra.
alter table equipe_login_toa
  alter column criado_por set default auth.uid();
alter table equipe_login_toa
  drop constraint if exists elt_cadastro_tem_autor;
alter table equipe_login_toa
  add constraint elt_cadastro_tem_autor check (criado_por is not null);

-- ============================================================
-- C · A tela para de sugerir
-- ============================================================
-- O nome do técnico e a equipe dele saíam de casar o login com a
-- matrícula da planilha. Acerta quase sempre — e é exatamente por isso
-- que ninguém confere. Quem diz de quem é o login é quem opera.
drop function if exists logins_sem_cadastro(date, date);

create function logins_sem_cadastro(
  p_de date default null, p_ate date default null)
returns table(login text, visitas bigint, primeira date, ultima date)
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
  )
  select v.login, count(*) as visitas,
         min(v.data_agendada) as primeira, max(v.data_agendada) as ultima
    from v
   where v.login is not null
     and equipe_do_login(v.base_id, v.login, v.data_agendada) is null
   group by 1
   order by 2 desc;
$fn$;

revoke all on function logins_sem_cadastro(date, date) from public, anon;
grant execute on function logins_sem_cadastro(date, date) to authenticated;

-- ============================================================
-- D · Técnico se desliga; apagar é outra coisa
-- ============================================================
-- Desligar é o caminho normal e cabe a quem edita equipe. Apagar é
-- conserto de cadastro errado: cabe só ao ADMIN — e nem ele apaga quem
-- já trabalhou, porque o histórico de contratos executados fica.
alter table tecnico add column if not exists situacao_em  timestamptz;
alter table tecnico add column if not exists situacao_por uuid references perfil(id);

drop policy if exists tecnico_escrita on tecnico;
create policy tecnico_insere on tecnico for insert to authenticated
  with check (empresa_id = minha_empresa()
              and base_id in (select bases_visiveis()) and eh_gestor());
create policy tecnico_atualiza on tecnico for update to authenticated
  using (empresa_id = minha_empresa()
         and base_id in (select bases_visiveis()) and eh_gestor())
  with check (empresa_id = minha_empresa()
              and base_id in (select bases_visiveis()) and eh_gestor());
create policy tecnico_apaga on tecnico for delete to authenticated
  using (empresa_id = minha_empresa()
         and base_id in (select bases_visiveis()) and tem_papel('ADMIN'));

drop policy if exists equipe_escrita on equipe;
create policy equipe_insere on equipe for insert to authenticated
  with check (empresa_id = minha_empresa()
              and base_id in (select bases_visiveis()) and eh_gestor());
create policy equipe_atualiza on equipe for update to authenticated
  using (empresa_id = minha_empresa()
         and base_id in (select bases_visiveis()) and eh_gestor())
  with check (empresa_id = minha_empresa()
              and base_id in (select bases_visiveis()) and eh_gestor());
create policy equipe_apaga on equipe for delete to authenticated
  using (empresa_id = minha_empresa()
         and base_id in (select bases_visiveis()) and tem_papel('ADMIN'));

-- A policy diz QUEM apaga. Quem diz O QUE não se apaga é o trigger:
-- policy não olha as outras tabelas, e um DELETE barrado por FK
-- devolveria "violates foreign key constraint" — verdade, e ilegível
-- para quem só queria desligar o técnico que saiu.
create or replace function tecnico_nao_se_apaga()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare n bigint;
begin
  select (select count(*) from visita where tecnico_responsavel_id = old.id)
       + (select count(*) from visita_evento where tecnico_id = old.id)
       + (select count(*) from evidencia where tecnico_id = old.id)
       + (select count(*) from equipamento_movimento where tecnico_id = old.id)
       + (select count(*) from perfil where tecnico_id = old.id)
    into n;
  if n > 0 then
    raise exception
      'O tecnico % (%) tem % registro(s) de historico. Desligue em vez de apagar — o que ele executou fica gravado.',
      old.nome, old.matricula, n using errcode = '23503';
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_tecnico_nao_se_apaga on tecnico;
create trigger trg_tecnico_nao_se_apaga before delete on tecnico
  for each row execute function tecnico_nao_se_apaga();

create or replace function equipe_nao_se_apaga()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare n bigint;
begin
  if old.codigo = 'SEM-LOGIN' then
    raise exception
      'A equipe "Sem login definido" e o abrigo dos contratos sem cadastro; nao se apaga.'
      using errcode = '23503';
  end if;
  select (select count(*) from visita where equipe_id = old.id)
       + (select count(*) from visita_evento where equipe_id = old.id)
       + (select count(*) from tecnico where equipe_id = old.id)
       + (select count(*) from reincidencia where equipe_anterior_id = old.id)
    into n;
  if n > 0 then
    raise exception
      'A equipe % tem % registro(s) de historico. Desative em vez de apagar — os contratos executados por ela ficam gravados.',
      old.codigo, n using errcode = '23503';
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_equipe_nao_se_apaga on equipe;
create trigger trg_equipe_nao_se_apaga before delete on equipe
  for each row execute function equipe_nao_se_apaga();

-- O caminho que a tela usa. RLS não restringe COLUNA (D-050): um UPDATE
-- liberado por linha deixaria mexer em matrícula e equipe de carona.
-- Aqui só a situação muda, e fica gravado quem mudou e quando.
create or replace function mudar_situacao_tecnico(p_tecnico uuid, p_situacao text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_ant text; v_mat text; v_nome text;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;
  if p_situacao is null or p_situacao not in ('ATIVO','FERIAS','AFASTADO','DESLIGADO') then
    raise exception 'Situacao invalida: %. Use ATIVO, FERIAS, AFASTADO ou DESLIGADO.',
      p_situacao using errcode = '23514';
  end if;

  select situacao, matricula, nome into v_ant, v_mat, v_nome
    from tecnico
   where id = p_tecnico and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if v_mat is null then
    raise exception 'Tecnico nao encontrado.' using errcode = 'P0002';
  end if;

  update tecnico
     set situacao = p_situacao, situacao_em = now(), situacao_por = auth.uid()
   where id = p_tecnico;

  return jsonb_build_object('matricula', v_mat, 'nome', v_nome,
                            'de', v_ant, 'para', p_situacao);
end;
$fn$;

revoke all on function mudar_situacao_tecnico(uuid, text) from public, anon;
grant execute on function mudar_situacao_tecnico(uuid, text) to authenticated;

revoke all on function tecnico_nao_se_apaga() from public, anon;
revoke all on function equipe_nao_se_apaga() from public, anon;

notify pgrst, 'reload schema';
