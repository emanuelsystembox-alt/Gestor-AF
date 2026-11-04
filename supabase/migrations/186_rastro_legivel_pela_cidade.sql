-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 186 — O rastro se lê pelo escopo de LEITURA (a cidade da gestão)      │
-- │                                                                      │
-- │ "por que o meu login de admin aparece a localização e login da       │
-- │  victoria não aparece? de onde o técnico baixou?" — Emanuel, 03/11.  │
-- │ Perguntado se o Coordenador vê o rastro: "Ver o rastro inteiro".     │
-- │                                                                      │
-- │ A Victoria (COORDENADOR) já é gestão — `tem_papel('CONTROLADOR')`    │
-- │ conta o Coordenador (158b) — e já via a trilha no Monitor e na fila  │
-- │ do dia, que são DEFINER e usam `ve_cidade_inteira()`. Só a policy da │
-- │ TABELA ficou na carteira (`equipes_visiveis()`: 0 equipes para ela). │
-- │ Então `local_da_baixa`, que é INVOKER, não achava ponto nenhum, e o  │
-- │ chip da baixa dada no TOA ("2 m · rastro") sumia calado: medido como │
-- │ authenticated, 1 local para ela contra 3 para o admin nos mesmos 4   │
-- │ contratos.                                                           │
-- │                                                                      │
-- │ Agora a policy usa `equipes_legiveis()`, o escopo de leitura (156a): │
-- │ o mesmo que o Monitor já mostrava. Continua só para a gestão         │
-- │ (`eh_gestao()`), e é SELECT — não abre escrita (traps.md: policy ALL).│
-- │ `eh_gestao()` NÃO foi alargada: ela decide dezenas de policies.      │
-- └──────────────────────────────────────────────────────────────────────┘

drop policy if exists rastro_ponto_leitura on public.rastro_ponto;
create policy rastro_ponto_leitura on public.rastro_ponto
  for select
  to authenticated
  using (
    empresa_id = (select minha_empresa())
    and (select eh_gestao())
    and ((select eh_gestor())
         or tecnico_id in (select t.id from tecnico t
                            where t.equipe_id in (select equipes_legiveis())))
  );

notify pgrst, 'reload schema';
