-- ============================================================
-- 007 - Endurecimento (achados do linter de seguranca do Supabase)
--
-- Tres licoes que valem para qualquer funcao nova neste projeto:
--
-- 1) SECURITY DEFINER ignora o RLS. Se a funcao faz algo privilegiado,
--    a autorizacao precisa ser conferida DENTRO dela. Revogar acesso
--    do 'anon' nao basta: qualquer usuario logado -- inclusive um
--    tecnico -- continuaria podendo chamar.
--
-- 2) O Supabase concede EXECUTE nominalmente a 'anon' e 'authenticated'
--    em toda funcao criada no schema public.
--    'revoke ... from public' NAO remove concessao nominal.
--    Tem que ser 'revoke ... from anon'.
--
-- 3) CREATE OR REPLACE preserva a ACL. Funcao criada do zero (por
--    exemplo depois de um RENAME) recebe as concessoes padrao de novo.
--    Sempre reconferir com has_function_privilege() depois de mexer.
-- ============================================================

-- A implementacao real sai do alcance da API: so o dono e o service_role.
alter function importar_toa(uuid, boolean) rename to importar_toa_interno;
revoke execute on function importar_toa_interno(uuid, boolean) from public;
revoke all     on function importar_toa_interno(uuid, boolean) from anon, authenticated;
alter function importar_toa_interno(uuid, boolean) set search_path = public;

-- A porta de entrada confere o papel antes de delegar.
create or replace function importar_toa(
  p_importacao_id uuid, p_simular boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para importar planilha.' using errcode = '42501';
  end if;
  return importar_toa_interno(p_importacao_id, p_simular);
end;
$fn$;

create or replace function previa_toa(p_importacao_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare msg text;
begin
  if not (eh_gestor() or tem_papel('CONTROLADOR')) then
    raise exception 'Sem permissao para importar planilha.' using errcode = '42501';
  end if;
  perform importar_toa_interno(p_importacao_id, true);
  return '{}'::jsonb;
exception when sqlstate 'P0001' then
  get stacked diagnostics msg = MESSAGE_TEXT;
  if left(msg, 7) = 'PREVIA:' then return substring(msg from 8)::jsonb; end if;
  raise;
end;
$fn$;

revoke execute on function importar_toa(uuid, boolean) from public, anon;
revoke execute on function previa_toa(uuid)            from public, anon;
grant  execute on function importar_toa(uuid, boolean) to authenticated;
grant  execute on function previa_toa(uuid)            to authenticated;

-- Helpers de permissao: fora do alcance do anon.
-- 'authenticated' mantem acesso porque as policies de RLS os chamam;
-- eles so relatam sobre o proprio auth.uid(), nao vazam nada.
revoke execute on function eh_gestor()           from public, anon;
revoke execute on function tem_papel(papel_tipo) from public, anon;
revoke execute on function equipes_visiveis()    from public, anon;
revoke execute on function meu_tecnico_id()      from public, anon;
grant  execute on function eh_gestor()           to authenticated;
grant  execute on function tem_papel(papel_tipo) to authenticated;
grant  execute on function equipes_visiveis()    to authenticated;
grant  execute on function meu_tecnico_id()      to authenticated;

-- search_path fixo: sem isto, um schema malicioso no caminho pode
-- sequestrar a resolucao de nomes dentro da funcao.
alter function marca_bloqueio()         set search_path = public;
alter function campos_cadastrais()      set search_path = public;
alter function situacao_do_toa(text)    set search_path = public;
alter function extrai_codigo(text)      set search_path = public;
alter function j_txt(jsonb, text)       set search_path = public;
alter function j_data(jsonb, text)      set search_path = public;
alter function j_hora(jsonb, text, int) set search_path = public;
alter function j_num(jsonb, text)       set search_path = public;
alter function j_ts(jsonb, text, text)  set search_path = public;
alter function j_interv(jsonb, text)    set search_path = public;

-- Extensao fora do schema public.
create schema if not exists extensions;
alter extension unaccent set schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter function norm_txt(text) set search_path = public, extensions;

-- ---------- Conferencia obrigatoria depois de rodar ----------
-- Nao confie no lint: pergunte ao banco.
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef;
--   -- esperado: anon_pode = false em todas
--
--   select norm_txt('  Instalação  de  Assinatura ');
--   -- esperado: INSTALACAO DE ASSINATURA
