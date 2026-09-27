-- ============================================================================
-- 094 · O campo lança a miscelânea do contrato
-- ============================================================================
-- > "no contrato que tem status, não aparece o botão de lançar miscelânea,
-- >  deveria aparecer também" — Emanuel, 27/09
--
-- `baixar_miscelanea` (089) é do almoxarifado: confere `almox_pode_mexer`,
-- e o técnico recebia 42501. A regra do dinheiro não muda — o material
-- gasto sai do saldo do TÉCNICO, amarrado ao contrato, e baixar o que ele
-- não tem é recusado —, só a porta:
--
--   · o técnico é SEMPRE o do login (o cliente não diz de quem sai);
--   · o contrato passa pela MESMA trava da foto e do equipamento
--     (`pode_anexar_na_visita`): da equipe dele, e só no dia (055-3).
--     Não é uma segunda cópia da regra — é a mesma função.
--
-- E `miscelanea_do_contrato` mostra ao técnico o que já foi lançado ali —
-- o razão (`miscelanea_movimento`) é do almoxarifado pelo RLS.
-- ============================================================================

create or replace function baixar_miscelanea_do_campo(p_visita uuid, p_itens jsonb,
                                                     p_observacao text default null)
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare v_tec uuid := meu_tecnico_id(); v_emp uuid := minha_empresa();
        v_it jsonb; v_qtd numeric; v_saldo numeric; v_item uuid; v_n int := 0;
begin
  if v_tec is null then
    raise exception 'Este login nao esta vinculado a um tecnico.' using errcode = '42501';
  end if;
  perform pode_anexar_na_visita(p_visita);

  for v_it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_qtd := nullif(v_it->>'quantidade', '')::numeric;
    v_item := (v_it->>'item_id')::uuid;
    continue when v_qtd is null or v_qtd <= 0;
    select coalesce(sum(quantidade), 0) into v_saldo from miscelanea_movimento
     where item_id = v_item and tecnico_id = v_tec and empresa_id = v_emp;
    if v_saldo < v_qtd then
      raise exception 'Voce tem % de %, nao da para lancar %.', v_saldo,
        (select nome from item_miscelanea where id = v_item), v_qtd using errcode = '23514';
    end if;
    insert into miscelanea_movimento (empresa_id, item_id, tecnico_id, quantidade, tipo,
                                      visita_id, motivo, criado_por)
    values (v_emp, v_item, v_tec, -v_qtd, 'CONSUMO', p_visita,
            nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid());
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Nenhum item com quantidade.' using errcode = '23514'; end if;
  return v_n;
end;
$fn$;
revoke all on function baixar_miscelanea_do_campo(uuid, jsonb, text) from public, anon;
grant execute on function baixar_miscelanea_do_campo(uuid, jsonb, text) to authenticated;

-- O que já saiu neste contrato. Leitura: quem enxerga a equipe do
-- contrato (o técnico dela, a gestão), sem abrir o razão inteiro.
create or replace function miscelanea_do_contrato(p_visita uuid)
returns table (item text, unidade text, quantidade numeric, tecnico text, criado_em timestamptz)
language sql stable security definer set search_path to 'public' as $fn$
  select i.nome, i.unidade, -m.quantidade, t.nome, m.criado_em
    from miscelanea_movimento m
    join item_miscelanea i on i.id = m.item_id
    left join tecnico t on t.id = m.tecnico_id
    join visita v on v.id = m.visita_id
   where m.visita_id = p_visita and m.tipo = 'CONSUMO'
     and m.empresa_id = minha_empresa()
     and (eh_gestor() or v.equipe_id in (select equipes_visiveis())
          or tem_permissao('almoxarifado.ver'))
   order by m.criado_em;
$fn$;
revoke all on function miscelanea_do_contrato(uuid) from public, anon;
grant execute on function miscelanea_do_contrato(uuid) to authenticated;

notify pgrst, 'reload schema';
