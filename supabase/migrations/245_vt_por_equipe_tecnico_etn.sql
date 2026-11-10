-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 245 — VT por equipe: o técnico ETN, com meta própria e por período   │
-- │       (D-357)                                                        │
-- │                                                                      │
-- │ "Podemos clicar em cima do nome e dizer se o Técnico é ETN ou não, o │
-- │  ETN a meta dele é 3 (...) temos que ter a opção de duplicar o       │
-- │  login, pois ele pode sair de ETN no dia tal e entrar como técnico   │
-- │  normal no dia x, ou seja a soma é diferente" — Emanuel, 10/11.      │
-- │                                                                      │
-- │ Na planilha da operação o ETN é marcado dia a dia na ESCALA e o SE   │
-- │ dele compara com $AI$3 = 3 (os outros, com $AI$2 = 5,7).             │
-- │                                                                      │
-- │ Aqui o ETN é um PERÍODO do login (de / até; sem "até" = em aberto).  │
-- │ A tela divide o login em duas linhas: os dias dentro do período vão  │
-- │ para a linha ETN (meta `vt_meta_etn`), os de fora ficam na normal    │
-- │ (meta `vt_meta_media`). Cada linha tem DIAS, MÉDIA e SE próprios —   │
-- │ e por isso a SOMA 1/0 muda.                                          │
-- │                                                                      │
-- │ Gravação só pela RPC (autor carimbado), pela gestão, na cidade       │
-- │ ativa — o mesmo de `marcar_escala_vt` (234). Períodos do mesmo login │
-- │ não se sobrepõem: o dia teria duas metas.                            │
-- └──────────────────────────────────────────────────────────────────────┘

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'vt_meta_etn', '3'::jsonb,
       'VT por equipe: média por dia para o técnico ETN contar na SOMA 1 (a planilha: $AI$3)'
  from empresa e
on conflict (empresa_id, chave) do nothing;

create table if not exists vt_etn (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id),
  base_id     uuid not null references base(id),
  login       text not null,
  de          date not null,
  ate         date,
  criado_por  uuid references auth.users(id),
  criado_em   timestamptz not null default now(),
  check (ate is null or ate >= de)
);
create index if not exists vt_etn_login_idx on vt_etn (base_id, login, de);
alter table vt_etn enable row level security;
drop policy if exists vt_etn_leitura on vt_etn;
create policy vt_etn_leitura on vt_etn for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis()));
-- Sem policy de escrita: só as RPCs abaixo gravam.
revoke all on vt_etn from anon;
grant select on vt_etn to authenticated;

create or replace function definir_etn_vt(p_login text, p_de date, p_ate date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base  uuid;
  v_login text := upper(btrim(p_login));
  v_id    uuid;
begin
  if not (select eh_gestao()) then
    raise exception 'Só a gestão marca o técnico ETN.' using errcode = '42501';
  end if;
  if v_login is null or v_login = '' or p_de is null then
    raise exception 'Informe o login e o primeiro dia como ETN.';
  end if;
  if p_ate is not null and p_ate < p_de then
    raise exception 'O último dia como ETN não pode ser antes do primeiro.';
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then
    raise exception 'Escolha a cidade no topo antes de marcar o ETN.';
  end if;
  if exists (select 1 from vt_etn e
              where e.base_id = v_base and e.login = v_login
                and daterange(e.de, e.ate, '[]') && daterange(p_de, p_ate, '[]')) then
    raise exception 'Esse login já é ETN em parte desse período — ajuste o período que existe.';
  end if;

  insert into vt_etn (empresa_id, base_id, login, de, ate, criado_por)
  values (minha_empresa(), v_base, v_login, p_de, p_ate, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function definir_etn_vt(text, date, date) from public, anon;
grant execute on function definir_etn_vt(text, date, date) to authenticated;

create or replace function remover_etn_vt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select eh_gestao()) then
    raise exception 'Só a gestão marca o técnico ETN.' using errcode = '42501';
  end if;
  delete from vt_etn
   where id = p_id
     and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Período ETN não encontrado na cidade ativa.';
  end if;
end;
$$;
revoke all on function remover_etn_vt(uuid) from public, anon;
grant execute on function remover_etn_vt(uuid) to authenticated;

-- Encerra o período em aberto: "ele pode sair de ETN no dia tal" — o último
-- dia ETN; do dia seguinte em diante o login volta à linha normal.
create or replace function encerrar_etn_vt(p_id uuid, p_ate date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r vt_etn;
begin
  if not (select eh_gestao()) then
    raise exception 'Só a gestão marca o técnico ETN.' using errcode = '42501';
  end if;
  select * into r from vt_etn
   where id = p_id and empresa_id = minha_empresa() and base_id in (select bases_visiveis());
  if not found then
    raise exception 'Período ETN não encontrado na cidade ativa.';
  end if;
  if p_ate is null or p_ate < r.de then
    raise exception 'O último dia como ETN não pode ser antes do primeiro (%).', to_char(r.de, 'DD/MM');
  end if;
  if exists (select 1 from vt_etn e
              where e.base_id = r.base_id and e.login = r.login and e.id <> r.id
                and daterange(e.de, e.ate, '[]') && daterange(r.de, p_ate, '[]')) then
    raise exception 'Esse fim encosta em outro período ETN do mesmo login.';
  end if;
  update vt_etn set ate = p_ate where id = p_id;
end;
$$;
revoke all on function encerrar_etn_vt(uuid, date) from public, anon;
grant execute on function encerrar_etn_vt(uuid, date) to authenticated;

notify pgrst, 'reload schema';
