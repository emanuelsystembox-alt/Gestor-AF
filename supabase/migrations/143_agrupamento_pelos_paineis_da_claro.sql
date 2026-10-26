-- ┌─ 143 · o agrupamento de cada código, dito pelo Emanuel ────────────┐
-- │ > "te mandei uma lista de códigos pra você colocar nos grupos caso │
-- │ >  tenha dúvidas (...) isso é válido somente para contratos        │
-- │ >  improdutivos; concluídos, auditoria e cancelado central não     │
-- │ >  entram" — Emanuel, 26/10                                        │
-- │                                                                     │
-- │ Ele abriu os painéis da CLARO agrupamento por agrupamento e mandou │
-- │ os MOTIVOS de cada um. Isso SUBSTITUI o que a planilha de 01/10    │
-- │ tinha dado por maioria, onde os dois discordam — o painel é do mês │
-- │ inteiro e é a fonte direta:                                        │
-- │   AGENDAMENTO      106, 101, 125, 107, 306                         │
-- │   PROCESSO VENDA   302, 402        (302 ia para AGENDAMENTO)       │
-- │   INFRA CLARO      305, 316, 206, 211, 308   (308 ia para AGEND.)  │
-- │   TUBULACAO        110                                             │
-- │   INFRA CLIENTE    303, 112                                        │
-- │   CHUVA            103                                             │
-- │   TÉCNICO          134, 850, 126                                   │
-- │                                                                     │
-- │ O 800 (Desatribuído / Auditar) tinha ganho INFRA CLARO da planilha │
-- │ e SAI: é cancelamento nosso (116), não quebra da operação.         │
-- │                                                                     │
-- │ AINDA SEM GRUPO, e só ele pode dizer: 301 Tipo de OS Incorreta     │
-- │ (23 O.S. em 7 dias) e 205 Falta Tap Ou Passivo (5). Não apareceram │
-- │ em nenhum dos painéis que ele mandou.                              │
-- └─────────────────────────────────────────────────────────────────────┘

update codigo_baixa set agrupamento_quebra = x.agr
from (values
  (106,'AGENDAMENTO'),(101,'AGENDAMENTO'),(125,'AGENDAMENTO'),
  (107,'AGENDAMENTO'),(306,'AGENDAMENTO'),
  (302,'PROCESSO VENDA'),(402,'PROCESSO VENDA'),
  (305,'INFRA CLARO'),(316,'INFRA CLARO'),(206,'INFRA CLARO'),
  (211,'INFRA CLARO'),(308,'INFRA CLARO'),
  (110,'TUBULACAO'),
  (303,'INFRA CLIENTE'),(112,'INFRA CLIENTE'),
  (103,'CHUVA'),
  (134,'TÉCNICO'),(850,'TÉCNICO'),(126,'TÉCNICO')
) as x(cod, agr)
where codigo_baixa.codigo = x.cod;

update codigo_baixa
   set agrupamento_quebra = null, responsavel_quebra = null
 where codigo = 800;

-- `impacto_quebra` (142) passou a aplicar as três exclusões, para o
-- período anterior contar a mesma coisa que a tela conta no atual:
-- cancelado pela central, desatribuído/auditar, e código improdutivo
-- cuja baixa termina em CONCLUIDA (570, 582, 583 — o serviço saiu, e a
-- própria CLARO os marca SEM_QUEBRA).

notify pgrst, 'reload schema';
