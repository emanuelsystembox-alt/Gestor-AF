-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 249 — VT por equipe: a projeção editável dia a dia, em lote (D-361)  │
-- │                                                                      │
-- │ "o certo é o sistema deixar editar os dias o volume, deixar editar   │
-- │  todas as folgas, o usuário também pode arrastar com o mouse até     │
-- │  onde pode apagar tudo e fazer manual (...) isso no projetado, tem   │
-- │  que dar liberdade para o usuário mexer para melhorar o resultado"   │
-- │  — Emanuel, 10/11.                                                   │
-- │                                                                      │
-- │ `vt_projecao_dia`: o volume escrito à mão num dia da projeção, por   │
-- │ login e linha (normal / ETN). `vt` nulo = APAGADO (o dia fica vazio  │
-- │ e não conta); sem linha = vale o plano (248).                        │
-- │                                                                      │
-- │ `editar_projecao_vt(itens)` aplica uma seleção inteira numa          │
-- │ transação. Cada item é {login, etn, dia, acao[, vt | codigo]}:       │
-- │   VALOR  — o dia vale `vt`; a escala do dia sai (vai trabalhar)      │
-- │   ESCALA — a escala do dia vira `codigo`; o volume escrito sai       │
-- │   APAGAR — o dia fica vazio; a escala do dia sai                     │
-- │   PADRAO — o volume escrito sai (volta ao plano); a escala fica      │
-- │ A escala é a de verdade (`vt_escala`, 234) — a mesma da visão real.  │
-- │ Só a gestão, na cidade ativa, como a escala e o plano.               │
-- └──────────────────────────────────────────────────────────────────────┘

create table if not exists vt_projecao_dia (
  empresa_id  uuid not null references empresa(id),
  base_id     uuid not null references base(id),
  login       text not null,
  dia         date not null,
  etn         boolean not null default false,
  vt          numeric check (vt is null or (vt >= 0 and vt <= 30)),
  criado_por  uuid references auth.users(id),
  criado_em   timestamptz not null default now(),
  primary key (base_id, login, dia, etn)
);
alter table vt_projecao_dia enable row level security;
drop policy if exists vt_projecao_dia_leitura on vt_projecao_dia;
create policy vt_projecao_dia_leitura on vt_projecao_dia for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis()));
revoke all on vt_projecao_dia from anon;
grant select on vt_projecao_dia to authenticated;

create or replace function editar_projecao_vt(p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base  uuid;
  v_emp   uuid := minha_empresa();
  it      jsonb;
  v_login text;
  v_dia   date;
  v_etn   boolean;
  v_acao  text;
  v_vt    numeric;
  v_cod   text;
  n       int := 0;
begin
  if not (select eh_gestao()) then
    raise exception 'Só a gestão edita a projeção do VT.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_itens) > 3000 then
    raise exception 'Seleção grande demais (máximo 3.000 células por vez).';
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then
    raise exception 'Escolha a cidade no topo antes de editar a projeção.';
  end if;

  for it in select * from jsonb_array_elements(p_itens) loop
    v_login := upper(btrim(it->>'login'));
    v_dia   := (it->>'dia')::date;
    v_etn   := coalesce((it->>'etn')::boolean, false);
    v_acao  := upper(coalesce(it->>'acao', ''));
    if v_login is null or v_login = '' or v_dia is null then
      raise exception 'Item sem login ou dia: %', it;
    end if;

    if v_acao = 'VALOR' then
      v_vt := (it->>'vt')::numeric;
      if v_vt is null or v_vt < 0 or v_vt > 30 then
        raise exception 'O volume tem de ser entre 0 e 30 VT (dia %).', to_char(v_dia, 'DD/MM');
      end if;
      delete from vt_escala where base_id = v_base and login = v_login and dia = v_dia;
      insert into vt_projecao_dia (empresa_id, base_id, login, dia, etn, vt, criado_por)
      values (v_emp, v_base, v_login, v_dia, v_etn, v_vt, auth.uid())
      on conflict (base_id, login, dia, etn) do update
         set vt = excluded.vt, criado_por = excluded.criado_por, criado_em = now();

    elsif v_acao = 'ESCALA' then
      v_cod := it->>'codigo';
      if v_cod is null or v_cod not in ('F', 'FE', 'FALTA', 'ATES.') then
        raise exception 'Escala "%" não existe — use F, FE, FALTA ou ATES.', v_cod;
      end if;
      delete from vt_projecao_dia where base_id = v_base and login = v_login and dia = v_dia and etn = v_etn;
      insert into vt_escala (empresa_id, base_id, login, dia, codigo, criado_por)
      values (v_emp, v_base, v_login, v_dia, v_cod, auth.uid())
      on conflict (base_id, login, dia) do update
         set codigo = excluded.codigo, criado_por = excluded.criado_por, criado_em = now();

    elsif v_acao = 'APAGAR' then
      delete from vt_escala where base_id = v_base and login = v_login and dia = v_dia;
      insert into vt_projecao_dia (empresa_id, base_id, login, dia, etn, vt, criado_por)
      values (v_emp, v_base, v_login, v_dia, v_etn, null, auth.uid())
      on conflict (base_id, login, dia, etn) do update
         set vt = null, criado_por = excluded.criado_por, criado_em = now();

    elsif v_acao = 'PADRAO' then
      delete from vt_projecao_dia where base_id = v_base and login = v_login and dia = v_dia and etn = v_etn;

    else
      raise exception 'Ação "%" não existe — use VALOR, ESCALA, APAGAR ou PADRAO.', v_acao;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function editar_projecao_vt(jsonb) from public, anon;
grant execute on function editar_projecao_vt(jsonb) to authenticated;

notify pgrst, 'reload schema';
