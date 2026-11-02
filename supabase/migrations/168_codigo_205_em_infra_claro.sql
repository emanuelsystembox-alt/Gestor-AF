-- ┌─ 168 · o 205 ganha agrupamento: INFRA CLARO ────────────────────────┐
-- │ > "esse código tá sem grupo, porém está assim acredito eu porque é │
-- │ >  da VT, tem que colocar ele em um grupo, ele se enquadra no      │
-- │ >  mesmo grupo do time da instalação" — Emanuel, 02/11             │
-- │                                                                     │
-- │ A 143 deixou o 205 (Falta Tap Ou Passivo / Tap Ou Passivo Lotado)  │
-- │ como "ainda sem grupo, e só ele pode dizer": não apareceu nos       │
-- │ painéis da CLARO que o Emanuel mandou (são da instalação; o 205 é  │
-- │ código da VT/HFC). O irmão dele na instalação é o 211 (Falta       │
-- │ NAP/NAP Lotada — o NAP é o TAP da fibra), que está em INFRA CLARO  │
-- │ desde a 143, junto com 203, 204, 206, 305 e 316. O 205 vai para o  │
-- │ mesmo grupo. O responsável (`responsavel_quebra`) segue vazio: o   │
-- │ painel da CLARO não disse, e não se chuta.                          │
-- │                                                                     │
-- │ Continua sem grupo: o 301 (Tipo de OS Incorreta).                  │
-- └─────────────────────────────────────────────────────────────────────┘

update codigo_baixa set agrupamento_quebra = 'INFRA CLARO' where codigo = 205;
