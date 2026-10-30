-- 158a: o papel COORDENADOR (Emanuel, 30/10: "tem que ter ADMIN, COP, o
-- resto que esta ai e mais coordenador agora"). Valor de enum novo nao
-- pode ser usado na mesma transacao em que nasce -- por isso migration
-- propria, antes da 158b. Escopo padrao: BASE (cai no `else` de
-- `escopo_padrao`), como controlador e supervisor.
alter type papel_tipo add value if not exists 'COORDENADOR' after 'COP';
