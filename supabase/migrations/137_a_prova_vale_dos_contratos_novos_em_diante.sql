-- ┌─ 137 · a prova vale DOS CONTRATOS NOVOS EM DIANTE ─────────────────┐
-- │ > "sobre o ranking do técnico deixa como estava, a regra funcionará │
-- │ >  a partir de novos contratos baixados, lembrando que para a      │
-- │ >  empresa conta normal, para o técnico que exigiria que o mesmo   │
-- │ >  faça os anexos" — Emanuel, 25/10                                │
-- │                                                                     │
-- │ MUDA A DECISÃO DA 136, que valia já, sem corte. Sem data de corte  │
-- │ a regra apagava o passado: 1.296 concluídos em 7 dias sem nenhuma  │
-- │ evidência, e o ranking inteiro em zero por trabalho feito sob      │
-- │ outra regra. Castigo retroativo não ensina nada — e o número que   │
-- │ o técnico vê precisa ser o número que ele podia ter mudado.        │
-- │                                                                     │
-- │ O corte é o DIA DE ATUAÇÃO (`evidencia_obriga_desde`, parâmetro,   │
-- │ nasce em amanhã): contrato anterior pontua como sempre pontuou;    │
-- │ de lá em diante, exige as evidências. Antes do corte a tela também │
-- │ não COBRA prova — cobrar o que não muda nada é ruído.              │
-- │                                                                     │
-- │ Para a EMPRESA nada disso vale, em nenhuma data: o serviço foi     │
-- │ feito e é faturado (só o expurgo do ADMIN com escopo TODOS mexe    │
-- │ nessa conta).                                                      │
-- └─────────────────────────────────────────────────────────────────────┘

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'evidencia_obriga_desde', to_jsonb((hoje_local() + 1)::text),
       'Dia de atuacao a partir do qual o contrato concluido PRECISA das evidencias para pontuar para o tecnico (137). Contrato anterior pontua como antes.'
  from empresa e
 where not exists (select 1 from parametro p where p.empresa_id = e.id and p.chave = 'evidencia_obriga_desde');

-- `prova_das_visitas` e `producao_por_tecnico` recriadas com o corte:
--   · `minimo` = 0 antes do corte (não cobra prova);
--   · `pontua_tecnico` = concluída e não expurgada E (antes do corte OU
--     com as evidências);
--   · `pontos_sem_prova` só conta o que está depois do corte.
-- Ver o corpo aplicado em `pg_get_functiondef`.
