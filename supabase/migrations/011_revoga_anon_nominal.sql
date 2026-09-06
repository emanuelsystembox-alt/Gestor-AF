-- O Supabase concede EXECUTE nominalmente a 'anon' e 'authenticated' em
-- toda funcao criada no schema public. 'revoke from public' NAO remove
-- uma concessao nominal -- precisa revogar do papel pelo nome.
--
-- Detalhe que explica o comportamento: CREATE OR REPLACE preserva a ACL
-- existente, mas a funcao criada do zero (apos o RENAME) recebeu as
-- concessoes padrao de novo.

revoke execute on function importar_toa(uuid, boolean) from anon;
revoke execute on function previa_toa(uuid)            from anon;
revoke execute on function eh_gestor()                 from anon;
revoke execute on function tem_papel(papel_tipo)       from anon;
revoke execute on function equipes_visiveis()          from anon;
revoke execute on function meu_tecnico_id()            from anon;

-- unaccent fora do schema public (o linter reclama, com razao:
-- extensao em public entra no caminho de resolucao de nomes)
create schema if not exists extensions;
alter extension unaccent set schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- norm_txt usa unaccent: o search_path precisa alcancar o novo schema
alter function norm_txt(text) set search_path = public, extensions;
