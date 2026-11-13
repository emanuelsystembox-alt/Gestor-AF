-- 264 · Tira de anon e authenticated o TRUNCATE, TRIGGER, REFERENCES e MAINTAIN das tabelas (D-379)
--
-- Achado em 13/11 (o agente do boletim notou na `foto_do_dia`; medido no banco inteiro): o
-- padrão de permissões do Supabase restaurado (`pg_default_acl` do `postgres`: arwdDxtm) dá a
-- quem está logado TRUNCATE em 107 das 112 tabelas, e a quem NÃO está logado (anon) em 93 —
-- além de TRIGGER, REFERENCES e MAINTAIN (Postgres 17: VACUUM, ANALYZE, REINDEX…). O RLS NÃO
-- vale para TRUNCATE. Hoje nada disso passa pela API (o PostgREST não oferece TRUNCATE), mas é
-- porta aberta à toa: bastaria uma função INVOKER com SQL dinâmico para virar estrago num banco
-- SEM BACKUP. É a mesma família da armadilha "restaurar o dump abre as funções ao anon"
-- (security.md). "Fechar em todo o banco" — Emanuel, 13/11.
--
-- O sistema nunca usa nenhum dos quatro como anon/authenticated: importação, carga e relógio
-- rodam como dono (DEFINER/postgres); a função de borda usa a service_role, que não muda.
-- SELECT/INSERT/UPDATE/DELETE ficam como estão (quem decide é o RLS).

do $$
declare t record;
begin
  for t in select c.relname
             from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, trigger, references, maintain on table public.%I from anon, authenticated',
                   t.relname);
  end loop;
  -- as views (visita_campo, vw_equipe_resumo, estoque_peca): TRUNCATE nem funciona nelas, mas
  -- a conferência tem de dar zero sem exceção a lembrar
  for t in select c.relname
             from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  loop
    execute format('revoke truncate, trigger, references on table public.%I from anon, authenticated',
                   t.relname);
  end loop;
end $$;

-- e a tabela que nascer amanhã já nasce sem eles
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
