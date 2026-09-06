-- Pseudo-codigos observados no sistema atual (05/09/2026).
-- Nao estao no GUIA_CODIGO_BAIXAv4 da CLARO: sao do proprio gestor,
-- para baixa feita direto no NETSMS. Apareceram como "-1" e "-2" no
-- grafico de motivos de improdutividade.
insert into codigo_baixa (codigo, descricao, familia, natureza, responsabilidade, revisar)
values
  (-1, 'Cancelado no Sistema NETSMS', 'ADMINISTRATIVO', 'CANCELAMENTO', null, false),
  (-2, 'Liberado no Sistema NETSMS',  'ADMINISTRATIVO', 'CANCELAMENTO', null, false)
on conflict (codigo) do nothing;

-- O TOA tambem emite variantes com sufixo, ex.:
-- "203 - Rede Externa Com Problema - REAGENDADO".
-- extrai_codigo() ja resolve isso: le so o numero do inicio da string,
-- entao a variante cai no mesmo 203. E o comportamento correto --
-- foi justamente o que corrigiu o defeito de 409 duplicado.
