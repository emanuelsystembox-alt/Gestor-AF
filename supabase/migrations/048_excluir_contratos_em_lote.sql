-- 048 · Excluir contratos em lote
--
-- ┌─ O QUE O EMANUEL PEDIU ──────────────────────────────────────────┐
-- │ "Deve ter uma função de clicar no lado direito e apagar           │
-- │  individual, ou caixa seletora para apagar todas as atividades ou │
-- │  somente algumas."                                                 │
-- └───────────────────────────────────────────────────────────────────┘
--
-- Chama `excluir_visita` uma por uma, de propósito: a barreira (papel +
-- permissão `servicos.excluir` + motivo obrigatório) e o evento por
-- contrato continuam exatamente os mesmos. Lote que toma um atalho pela
-- regra é a forma clássica de o lote apagar o que a exclusão individual
-- teria recusado.
--
-- Exclusão aqui é LÓGICA (`excluido_em`), como sempre foi: o contrato
-- sai da tela e continua no banco, com quem excluiu e por quê.
create or replace function excluir_visitas(p_visitas uuid[], p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid; n_ok int := 0; n_ja int := 0; n_erro int := 0; v_erros text[] := '{}';
begin
  if p_visitas is null or array_length(p_visitas, 1) is null then
    raise exception 'Nenhum contrato selecionado.' using errcode = '23514';
  end if;
  -- Trava de sanidade: seleção de milhares quase sempre é engano de
  -- "selecionar tudo" num filtro largo, e exclusão em massa silenciosa
  -- é o tipo de coisa que ninguém desfaz na sexta à noite.
  if array_length(p_visitas, 1) > 500 then
    raise exception 'Selecao de % contratos e grande demais para uma acao so (limite 500).',
      array_length(p_visitas, 1) using errcode = '23514';
  end if;

  foreach v_id in array p_visitas loop
    begin
      if (excluir_visita(v_id, p_motivo) ->> 'ja_estava_excluido')::boolean then
        n_ja := n_ja + 1;
      else
        n_ok := n_ok + 1;
      end if;
    exception when others then
      n_erro := n_erro + 1;
      v_erros := v_erros || SQLERRM;
    end;
  end loop;

  -- Se NENHUM saiu, o erro não pode virar "0 excluídos" em verde: quem
  -- clicou precisa ver a recusa.
  if n_ok = 0 and n_erro > 0 then
    raise exception '%', coalesce(v_erros[1], 'Nao consegui excluir.') using errcode = '42501';
  end if;

  return jsonb_build_object('excluidos', n_ok, 'ja_estavam', n_ja,
                            'erros', n_erro, 'primeiro_erro', v_erros[1]);
end;
$fn$;

revoke all on function excluir_visitas(uuid[], text) from public, anon;
grant execute on function excluir_visitas(uuid[], text) to authenticated;

notify pgrst, 'reload schema';
