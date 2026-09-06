-- Endurecimento (achados do linter de seguranca do Supabase)
--
-- 1) importar_toa/previa_toa eram executaveis por 'anon'.
--    revoke ... from anon nao basta: no Postgres a funcao nasce com
--    EXECUTE para PUBLIC, e anon herda dali. Tem que revogar de PUBLIC.
--
-- 2) Sendo SECURITY DEFINER, a funcao roda como dona e ignora o RLS.
--    So revogar de anon deixaria QUALQUER usuario logado -- inclusive
--    um tecnico -- disparar importacao. A autorizacao passa a ser
--    verificada DENTRO da funcao.
--
-- 3) search_path fixo em todas.

alter function importar_toa(uuid, boolean) rename to importar_toa_interno;
revoke execute on function importar_toa_interno(uuid, boolean) from public;
revoke all     on function importar_toa_interno(uuid, boolean) from anon, authenticated;

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

revoke execute on function importar_toa(uuid, boolean) from public;
revoke execute on function previa_toa(uuid)            from public;
grant  execute on function importar_toa(uuid, boolean) to authenticated;
grant  execute on function previa_toa(uuid)            to authenticated;

revoke execute on function eh_gestor()           from public;
revoke execute on function tem_papel(papel_tipo) from public;
revoke execute on function equipes_visiveis()    from public;
revoke execute on function meu_tecnico_id()      from public;
grant  execute on function eh_gestor()           to authenticated;
grant  execute on function tem_papel(papel_tipo) to authenticated;
grant  execute on function equipes_visiveis()    to authenticated;
grant  execute on function meu_tecnico_id()      to authenticated;

alter function marca_bloqueio()            set search_path = public;
alter function campos_cadastrais()         set search_path = public;
alter function norm_txt(text)              set search_path = public;
alter function situacao_do_toa(text)       set search_path = public;
alter function extrai_codigo(text)         set search_path = public;
alter function j_txt(jsonb, text)          set search_path = public;
alter function j_data(jsonb, text)         set search_path = public;
alter function j_hora(jsonb, text, int)    set search_path = public;
alter function j_num(jsonb, text)          set search_path = public;
alter function j_ts(jsonb, text, text)     set search_path = public;
alter function j_interv(jsonb, text)       set search_path = public;
alter function importar_toa_interno(uuid, boolean) set search_path = public;
