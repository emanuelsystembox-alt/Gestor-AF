-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 248 — VT por equipe: o PLANO de cada login, para a visão projetada   │
-- │       (D-360)                                                        │
-- │                                                                      │
-- │ "é bom fazermos uma visão de projeção, ou seja, se ele produzir nos  │
-- │  dias que eu acho que ele vai trabalhar, e fizer a quantidade que eu │
-- │  disse que ele vai fazer, fechar tanto (...) o normal é 6 vt (...)   │
-- │  então o sistema mesmo sugere o volume que ele precisa fazer por     │
-- │  dia, para atingir o objetivo" — Emanuel, 10/11.                     │
-- │                                                                      │
-- │ Os dias que ele vai trabalhar = os dias sem escala (F, FE, FALTA,    │
-- │ ATES.) — a escala futura se marca na mesma célula. A quantidade = o  │
-- │ PLANO do login no mês: `vt_plano` (por linha: a normal e a ETN), e   │
-- │ sem plano gravado vale o padrão — `vt_plano_padrao` (6, "o normal é  │
-- │ 6 vt") e `vt_plano_padrao_etn` (3, a meta do ETN). A conta da        │
-- │ projeção e do "precisa por dia" é da tela, sobre os mesmos dados.    │
-- │ Gravação só pela RPC, pela gestão, na cidade ativa (como a escala).  │
-- └──────────────────────────────────────────────────────────────────────┘

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, p.chave, p.valor, p.descricao
  from empresa e
 cross join (values
   ('vt_plano_padrao', '6'::jsonb, 'VT por equipe: VT por dia que se espera do técnico na projeção, sem plano próprio'),
   ('vt_plano_padrao_etn', '3'::jsonb, 'VT por equipe: VT por dia que se espera do técnico ETN na projeção, sem plano próprio')
 ) as p(chave, valor, descricao)
on conflict (empresa_id, chave) do nothing;

create table if not exists vt_plano (
  empresa_id  uuid not null references empresa(id),
  base_id     uuid not null references base(id),
  login       text not null,
  mes         date not null check (mes = date_trunc('month', mes)::date),
  etn         boolean not null default false,
  vt_dia      numeric not null check (vt_dia >= 0 and vt_dia <= 30),
  criado_por  uuid references auth.users(id),
  criado_em   timestamptz not null default now(),
  primary key (base_id, login, mes, etn)
);
alter table vt_plano enable row level security;
drop policy if exists vt_plano_leitura on vt_plano;
create policy vt_plano_leitura on vt_plano for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis()));
revoke all on vt_plano from anon;
grant select on vt_plano to authenticated;

-- Grava (ou, com p_vt_dia nulo, tira — volta ao padrão) o plano de um login no mês.
create or replace function definir_plano_vt(p_login text, p_mes date, p_etn boolean, p_vt_dia numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base  uuid;
  v_login text := upper(btrim(p_login));
  v_mes   date := date_trunc('month', p_mes)::date;
begin
  if not (select eh_gestao()) then
    raise exception 'Só a gestão define o plano do VT.' using errcode = '42501';
  end if;
  if p_vt_dia is not null and (p_vt_dia < 0 or p_vt_dia > 30) then
    raise exception 'O plano tem de ser entre 0 e 30 VT por dia.';
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then
    raise exception 'Escolha a cidade no topo antes de definir o plano.';
  end if;

  if p_vt_dia is null then
    delete from vt_plano
     where base_id = v_base and login = v_login and mes = v_mes and etn = coalesce(p_etn, false);
  else
    insert into vt_plano (empresa_id, base_id, login, mes, etn, vt_dia, criado_por)
    values (minha_empresa(), v_base, v_login, v_mes, coalesce(p_etn, false), p_vt_dia, auth.uid())
    on conflict (base_id, login, mes, etn) do update
       set vt_dia = excluded.vt_dia, criado_por = excluded.criado_por, criado_em = now();
  end if;
end;
$$;
revoke all on function definir_plano_vt(text, date, boolean, numeric) from public, anon;
grant execute on function definir_plano_vt(text, date, boolean, numeric) to authenticated;

notify pgrst, 'reload schema';
