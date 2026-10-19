-- ┌─ 105 · a importação que falhou diz que falhou, e por quê ─────────┐
-- │ > "se não importou ou deu erro o sistema deve apontar, nesse caso  │
-- │ >  ele ta dando esperança" — Emanuel, 17/10                        │
-- │                                                                    │
-- │ A tentativa que estourou os 8 s (D-181) ficou no histórico como    │
-- │ "Processando" para sempre: a tela deduzia o estado de              │
-- │ `aplicado_em` e não lia `status`, e ninguém gravava o erro em      │
-- │ lugar nenhum — ele só existia na tela de quem clicou, até fechar   │
-- │ a aba. O resto do time via "Processando" e esperava.               │
-- │                                                                    │
-- │ Agora a tela grava status ERRO + a mensagem quando qualquer etapa  │
-- │ falha, e o histórico lê o status. Ver D-182.                       │
-- └────────────────────────────────────────────────────────────────────┘

alter table importacao add column if not exists erro_mensagem text;
comment on column importacao.erro_mensagem is
  'O que deu errado, quando a importação falhou (status ERRO). Gravado pela '
  'tela no momento da falha, para o time inteiro ver no histórico (105, D-182).';

-- A tentativa de 17/10 que estourou o tempo (já marcada ERRO na 104).
update importacao
   set erro_mensagem = 'O banco demorou mais que o limite de 8 s e desfez a importação inteira — nenhum contrato entrou (antes da 104).'
 where status = 'ERRO' and erro_mensagem is null and aplicado_em is null
   and arquivo_nome = 'Atividades-MAN-AFLINE_17_10_26.xlsx';

notify pgrst, 'reload schema';
