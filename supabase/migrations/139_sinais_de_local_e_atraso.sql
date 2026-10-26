-- ┌─ 139 · um ícone por problema: baixa LONGE e janela ATRASADA ───────┐
-- │ > "é bom a gente criar mais uns 3 a 4 ícones para sinalizar os     │
-- │ >  problemas diferentes. Por exemplo, baixou o contrato longe do   │
-- │ >  cliente, perdeu TEC1, atendimento dentro da janela, técnicos    │
-- │ >  atrasados, técnicos de baixa produtividade no dia"              │
-- │ >  — Emanuel, 25/10                                                │
-- │                                                                     │
-- │ Dos cinco que ele citou, TRÊS já eram sinal: TEC1 (que **é** a     │
-- │ aderência à janela — ele confirmou que são a mesma coisa) e RITMO. │
-- │ Faltavam dois, e os dois já existiam como DADO sem virar aviso:    │
-- │                                                                     │
-- │  · LOCAL  — a baixa saiu fora do raio de 200 m (096, D-170). O     │
-- │    número estava em `local_da_baixa` desde setembro, mas alguém    │
-- │    tinha de abrir contrato por contrato para achar.                │
-- │  · ATRASO — a janela está acabando e o técnico não chegou.         │
-- │    Definição escolhida pelo Emanuel entre três: avisa ENQUANTO     │
-- │    ainda dá tempo de ligar para ele — 30 min antes do fim da       │
-- │    janela (`atraso_antecedencia_min`). CHEGOU = está EM_EXECUCAO   │
-- │    ou já encerrou, e aí o sinal apaga sozinho.                     │
-- │                                                                     │
-- │ O SINO fica com o RESTO (suporte, GPS, cerca, material,            │
-- │ abastecimento, dois ativos, sumiu do TOA): decisão dele, para cada │
-- │ coisa contar num lugar só e a soma da barra bater.                 │
-- │                                                                     │
-- │ Medido depois: `sinais_do_dia` em 146 ms, com `local_da_baixa`     │
-- │ chamada UMA vez (o array dos que estão fora é guardado e reusado   │
-- │ no insert e na vigência).                                          │
-- └─────────────────────────────────────────────────────────────────────┘

alter table sinal drop constraint if exists sinal_tipo_check;
alter table sinal add constraint sinal_tipo_check check (tipo in (
  'AJUDA', 'TEC1', 'RITMO', 'QUEBROU', 'MATERIAL', 'ABASTECIMENTO', 'CERCA',
  'GPS', 'DOIS_ATIVOS', 'SUMIU_TOA', 'LOCAL', 'ATRASO'));

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'atraso_antecedencia_min', '30'::jsonb,
       'Minutos ANTES do fim da janela em que a central comeca a avisar que o tecnico nao chegou (139).'
  from empresa e
 where not exists (select 1 from parametro p where p.empresa_id = e.id and p.chave = 'atraso_antecedencia_min');

-- `sinais_do_dia` ganhou os dois blocos (LOCAL e ATRASO), duas variáveis
-- (`v_fora`, `v_antec`) e os dois tipos na lista do que a gestão vê.
-- Aplicado por substituição sobre o corpo VIVO (traps.md), conferindo
-- que a troca casou antes de executar. Ver `pg_get_functiondef`.
--
-- Provado em transação desfeita: contrato de hoje posto Na entrada com a
-- janela vencida acendeu "Janela acabando sem chegada: DANILO PAIXAO
-- SOUZA · contrato 225661210 · janela até 18:00 · Na entrada"; ao mudar
-- para EM_EXECUCAO, o sinal vigente foi a zero.

notify pgrst, 'reload schema';
