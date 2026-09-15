-- ============================================================
-- 072 · Cancelada não é cinza
--
-- > "Cancelado não é cinza, e uma cor mais vermelho claro, tem que
-- >  corrigir." — Emanuel, 14/09
--
-- O cadastro já dizia vermelho: `situacao_visita.cor` = #d33724 desde a
-- 025. Quem pintava de cinza era o PADRÃO COMPILADO do front
-- (`--st-cancelada: #6b7280`), e ele ganha a corrida — `carregarSituacoes()`
-- é disparada sem `await` no login e só sobrepõe o objeto depois que a
-- tela já desenhou. Resultado: a lista abre cinza e não repinta, porque
-- mutar um objeto de módulo não provoca render no React.
--
-- Então o conserto tem duas pontas, e as duas entram hoje:
--   1. o padrão compilado (app/src/styles.css e campo/src/lib/dominio.ts)
--   2. o cadastro aqui, para os dois falarem o MESMO vermelho e a tela
--      não piscar de um tom para o outro quando a consulta chega.
--
-- Por que #d9736e e não o vermelho da marca: `--st-conflito` (#e4262f) é
-- o ALARME da tela — TEC1 fora do padrão, conflito de importação. Se
-- cancelada usar o mesmo vermelho vivo, uma lista com 7 cancelamentos
-- normais fica com cara de sete alarmes. Cancelado é um fato encerrado e
-- ruim: vermelho, mas apagado.
--
-- Isto é DML de cadastro, não DDL — o Emanuel pode trocar de novo
-- sozinho em Configurações → Status, sem migration nenhuma.
-- ============================================================

update situacao_visita
   set cor = '#d9736e'
 where codigo = 'CANCELADA'
   and cor = '#d33724';   -- não sobrescreve escolha que alguém já fez
