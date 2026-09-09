-- 061 · O gatilho da 059 nasceu aberto
--
-- A conferência obrigatória do CLAUDE.md pegou uma regressão minha:
--
--   select p.proname from pg_proc p ... where p.prosecdef
--     and has_function_privilege('anon', p.oid, 'EXECUTE');
--   → aviso_do_evento
--
-- Era ZERO antes da 059. `aviso_do_evento` é SECURITY DEFINER e foi
-- criada sem `revoke` — e o Supabase concede EXECUTE nominal a `anon`
-- em toda função nova do schema `public`. Está escrito na primeira
-- armadilha do CLAUDE.md, e mesmo assim escapou.
--
-- Na prática o estrago seria pequeno: é função de gatilho, e chamá-la
-- fora de um trigger estoura por falta de NEW. Mas "difícil de
-- explorar" não é o padrão daqui — o padrão é `anon` não alcançar
-- DEFINER nenhuma, para ninguém precisar julgar caso a caso.

revoke all on function aviso_do_evento() from public, anon, authenticated;

-- Conferência (esperado: zero linhas)
--   select p.proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.prosecdef
--     and has_function_privilege('anon', p.oid, 'EXECUTE');
