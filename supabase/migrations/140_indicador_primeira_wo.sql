-- ┌─ 140 · PRIMEIRA WO: que horas o técnico chega no primeiro cliente ─┐
-- │ > "o primeiro contrato que o técnico chegou na casa do cliente.    │
-- │ >  Ignore os contratos informativos, tem que ser o contrato real   │
-- │ >  mesmo (...) a meta para esse indicador é 8 e vinte (...) o      │
-- │ >  sistema deve informar a média que o técnico demora para chegar  │
-- │ >  (...) uma tabela de todos os técnicos, quem é que mais chega    │
-- │ >  atrasado, fazer gráficos dos 10 piores, para que o coordenador  │
-- │ >  possa atuar (...) já deve mapear para trás" — Emanuel, 25/10    │
-- │                                                                     │
-- │ CHEGOU = `visita.inicio`, a hora em que a atividade começou no     │
-- │ TOA. É a ÚNICA fonte que existe para trás: o aplicativo começou    │
-- │ agora e o evento de chegada dele não tem histórico. Lida em        │
-- │ horário de Manaus — em UTC as 20h daqui já são o dia seguinte.     │
-- │                                                                     │
-- │ CONTRATO REAL = natureza PRODUTIVA **e** com número de contrato.   │
-- │ Derivado do dado, não de lista escrita à mão: tira Refeição, Na    │
-- │ Base, Apoio a outro técnico e Almoxarifado (JORNADA), e também     │
-- │ "Refeicao." (com ponto, cadastrada como PRODUTIVA por engano) e    │
-- │ "Corte no Drop", que vem sem contrato.                             │
-- │                                                                     │
-- │ DIA SEM ATENDIMENTO NÃO ENTRA: folga, férias e dia sem rota não    │
-- │ são atraso. A tela mostra quantos dias cada um tem, para ninguém   │
-- │ confundir "o pior" com "o que trabalhou mais dias".                │
-- │                                                                     │
-- │ Medido em 14 dias, antes de escrever a tela: 377 dias-técnico, 65  │
-- │ técnicos, chegada média 08:39, **40,1% dentro da meta**, o mais    │
-- │ cedo 07:58 e o mais tarde 15:09.                                   │
-- └─────────────────────────────────────────────────────────────────────┘

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'primeira_wo_meta', '"08:20"'::jsonb,
       'Hora limite da PRIMEIRA WO do dia (140). Chegar depois disso conta como fora da meta.'
  from empresa e
 where not exists (select 1 from parametro p where p.empresa_id = e.id and p.chave = 'primeira_wo_meta');

-- `primeira_wo_dia(de, ate)`   — a primeira WO de cada técnico em cada
--   dia, com o contrato que ele abriu e os minutos acima da meta.
-- `primeira_wo_tecnico(de,ate)`— o resumo por técnico: dias, chegada
--   média, mais cedo, mais tarde, % dentro e o atraso médio.
--   O atraso médio conta SÓ os dias fora da meta: quem chegou cedo num
--   dia não "compensa" o dia em que chegou tarde — média de sinal
--   trocado esconderia o problema.
-- As duas são SECURITY DEFINER e filtram por empresa, cidade ativa e
-- equipes visíveis. Medido: 57 ms no período de 14 dias.
-- Ver o corpo aplicado em `pg_get_functiondef`.

notify pgrst, 'reload schema';
