-- ┌─ 102 · COM_IMPEDIMENTO passa a se chamar "Ticket de suporte" ──────┐
-- │ > "opção COM_IMPEDIMENTO vamos trocar o nome para Ticket de        │
-- │ >  suporte" — Emanuel, 17/10                                       │
-- │                                                                    │
-- │ Só o RÓTULO muda. O código continua `COM_IMPEDIMENTO`: é ele que   │
-- │ está no CHECK de `visita.situacao`, em `situacoes_terminais()`, no │
-- │ gatilho do status ativo (095), nas travas do campo e no histórico  │
-- │ — trocar o código reescreveria o passado e quebraria a importação. │
-- │                                                                    │
-- │ Desde a D-169 o pedido de ajuda do campo É este status; o nome     │
-- │ novo diz o que ele virou. Ver D-179.                               │
-- │                                                                    │
-- │ O rótulo é cadastro (025): a web lê daqui. Os padrões de partida   │
-- │ no código (`SITUACAO_INFO` na web, `dominio.ts` no aplicativo)     │
-- │ mudam junto, para não voltar o nome antigo quando o banco não      │
-- │ responder.                                                         │
-- └────────────────────────────────────────────────────────────────────┘

update situacao_visita
   set label = 'Ticket de suporte'
 where codigo = 'COM_IMPEDIMENTO';
