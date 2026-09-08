-- 053 · O produto pendente é DA O.S. — pelo Ponto
--
-- ┌─ O QUE O EMANUEL MOSTROU ────────────────────────────────────────┐
-- │ "Ele trouxe mais produto do que devia. Quero que traga somente o  │
-- │  primeiro pendente que aparece da O.S. selecionada; se tiver mais │
-- │  pendentes, não vamos trazer da mesma O.S."                        │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ⚠ **Isto corrige o D-106, onde eu afirmei que o produto não amarrava
--   na O.S.** Eu comparei o id do item com o NÚMERO da O.S., não bateu,
--   e conclui que não havia vínculo. Errado: a tela "Produtos" do TOA
--   chama aquela coluna de **Ponto**, e a planilha traz `Ponto 1..10`
--   ao lado de `Número da O.S 1..10`. O vínculo estava ali o tempo
--   todo, na coluna que eu não olhei — e a captura de tela que o
--   Emanuel mandou tinha o cabeçalho escrito.
--
--   Contrato 225826503, conferido contra a tela do TOA:
--     O.S. 2607853470 · ponto 34668915 → ACESSO VIRTUA
--     O.S. 2607853481 · ponto 34668916 → BL 500M SINGLE…, COMODATO,
--                                        ACESSO GRATIS
--
--   Cobertura: das 1.128 O.S. com ponto, **1.127 casam** com produto.
--
-- A tela mostrava os 4 pendentes do contrato numa pilha só. Agora cada
-- O.S. mostra **o primeiro pendente do ponto dela**. O maior contrato
-- saiu de 33 etiquetas para 7 — e as 7 dizem alguma coisa.
alter table ordem_servico add column if not exists produto_pendente text;

comment on column ordem_servico.produto_pendente is
  'Primeiro produto pendente do Ponto desta O.S. (053).';

create or replace function extrair_produtos(p_visita uuid)
returns int language plpgsql security definer set search_path to 'public' as $fn$
declare v_texto text; n int := 0;
begin
  select dados_origem->>'Produto' into v_texto from visita where id = p_visita;

  delete from visita_produto where visita_id = p_visita;

  if coalesce(btrim(v_texto), '') = '' then
    update visita set produtos_pendentes = null where id = p_visita;
    update ordem_servico set produto_pendente = null where visita_id = p_visita;
    return 0;
  end if;

  insert into visita_produto (visita_id, item_id, nome, situacao, ordem)
  select p_visita, m[1], btrim(m[2]), lower(m[3]), row_number() over ()
    from regexp_matches(v_texto, '(\d+)\|([^|]+?)\|([a-z]+)', 'g') as m;
  get diagnostics n = row_count;

  -- O primeiro pendente do PONTO daquela O.S. "Primeiro" é a ordem em
  -- que o TOA mandou, que é a mesma da tela dele.
  update ordem_servico o
     set produto_pendente = (
       select p.nome from visita_produto p
        where p.visita_id = p_visita and p.item_id = o.ponto
          and p.situacao = 'pendente'
        order by p.ordem limit 1)
   where o.visita_id = p_visita;

  -- O resumo do contrato passa a ser a lista dos primeiros de cada O.S.
  update visita v
     set produtos_pendentes = (
       select array_agg(o.produto_pendente order by o.sequencia)
         from ordem_servico o
        where o.visita_id = p_visita and o.produto_pendente is not null)
   where v.id = p_visita;

  return n;
end;
$fn$;

revoke all on function extrair_produtos(uuid) from public, anon;
grant execute on function extrair_produtos(uuid) to authenticated;

-- Recalcula o que já está no banco.
do $$
declare r record; n int := 0;
begin
  for r in select id from visita
            where dados_origem ? 'Produto' and excluido_em is null loop
    n := n + extrair_produtos(r.id);
  end loop;
  raise notice '053: % itens reprocessados.', n;
end $$;

notify pgrst, 'reload schema';
