-- ┌─ 110 · o papel ROBO ───────────────────────────────────────────────┐
-- │ O sincronismo com o TOA (111, D-189) importa em nome de um usuário │
-- │ próprio, o "Robô de sincronismo" — decisão do Emanuel, 19/10:      │
-- │ "vamos fazer dessa forma".                                         │
-- │                                                                    │
-- │ Nenhum papel existente servia: quem importa hoje é ADMIN, COP ou   │
-- │ CONTROLADOR, e os três também baixam, transferem e excluem         │
-- │ contrato. O robô fica num PC ligado o dia todo; se a senha dele    │
-- │ vazar, o estrago tem de ser "alguém importou uma planilha", e não  │
-- │ "alguém excluiu a rota".                                           │
-- │                                                                    │
-- │ Arquivo separado porque `alter type ... add value` não pode ser    │
-- │ usado na mesma transação que o cria — a 111 usa o valor.           │
-- └────────────────────────────────────────────────────────────────────┘

alter type papel_tipo add value if not exists 'ROBO';
