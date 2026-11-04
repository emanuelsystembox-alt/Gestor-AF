-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 195 — Código de baixa 801 · Transbordo para CLARO / PARCEIRO          │
-- │                                                                      │
-- │ "crie um novo código chamado 801 chamado - Transbordo para CLARO /   │
-- │  PARCEIRO - sem subfalha ok, para quando o usuário quiser justificar │
-- │  para onde o contrato foi" — Emanuel, 03/11. Até aqui se usava o 800 │
-- │ (Desatribuído) com a observação "Transbordo para CLARO / PARCEIRO".  │
-- │                                                                      │
-- │ Global (empresa_id nulo), como os códigos da CLARO — por isso por    │
-- │ migration (traps.md: o RLS não deixa editar código global). Mesma    │
-- │ família, natureza e destino do 800: ADMINISTRATIVO, CANCELAMENTO,    │
-- │ Cancelada. Sem sub-falha (nenhuma linha em sub_falha). Diferente do  │
-- │ 800, o 801 NÃO é o "Auditar": o 800 é o que o próprio sistema põe    │
-- │ quando o contrato some do TOA (D-191); o 801 é escolha de quem baixa.│
-- └──────────────────────────────────────────────────────────────────────┘

insert into public.codigo_baixa (codigo, descricao, familia, natureza, revisar, ativo, empresa_id,
                                 situacao_destino, situacao_origem, situacao_em)
values (801, 'Transbordo para CLARO / PARCEIRO', 'ADMINISTRATIVO', 'CANCELAMENTO', false, true, null,
        'CANCELADA', 'CADASTRO', now())
on conflict (codigo) do nothing;

select codigo, descricao, familia, natureza, situacao_destino, ativo
  from public.codigo_baixa where codigo in (800, 801) order by codigo;
