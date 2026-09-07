-- 036 · Equipe abrigo para login não cadastrado
--
-- Contrato cujo "Login do Técnico" veio no TOA mas não está cadastrado
-- em nenhuma equipe ficava com `equipe_id` nulo — e sumia de tudo que é
-- agrupado por equipe, inclusive da produtividade.
--
-- Ficar invisível é pior que ficar numa caixa errada de propósito: a
-- caixa errada com nome grita. Hoje são 8 visitas, de 1 login (Z690579),
-- que a tela de Equipes já acusava em "Fora do cadastro".

insert into equipe (base_id, codigo, nome, ativo, empresa_id, supervisor_nome)
select b.id, 'SEM-LOGIN', 'Login não cadastrado', true, b.empresa_id, null
  from base b
 where not exists (select 1 from equipe e
                    where e.base_id = b.id and e.codigo = 'SEM-LOGIN');

comment on table equipe is
  'A equipe de codigo SEM-LOGIN e abrigo: recebe o contrato cujo '
  '"Login do Tecnico" veio no TOA mas nao esta cadastrado em nenhuma '
  'equipe. E um alarme visivel, nao um destino final.';

create or replace function equipe_abrigo(p_base uuid)
returns uuid language sql stable set search_path to 'public' as $fn$
  select id from equipe where base_id = p_base and codigo = 'SEM-LOGIN' limit 1;
$fn$;

revoke all on function equipe_abrigo(uuid) from public, anon;

-- `equipe_do_login` responde "de quem é este login". Se a resposta é
-- "não sei", ela deve dizer não sei — misturar isso com o abrigo faria
-- a função mentir para todo mundo que a chama (`corrigir_equipe_pelo_login`
-- passaria a "achar" que todo login tem dono).
--
-- Então o abrigo entra numa camada acima: `equipe_do_contrato` responde
-- "para onde vai este contrato", que é outra pergunta.
create or replace function equipe_do_contrato(
  p_base uuid, p_login text, p_data date default current_date)
returns uuid language sql stable set search_path to 'public' as $fn$
  select case
    -- Sem login no TOA não há o que abrigar: é jornada, e jornada não
    -- pertence a equipe nenhuma por falta de dado. Pôr a jornada no
    -- abrigo misturaria "não sei de quem é" com "não é de ninguém".
    when nullif(btrim(coalesce(p_login, '')), '') is null then null
    else coalesce(equipe_do_login(p_base, p_login, p_data),
                  equipe_abrigo(p_base))
  end;
$fn$;

revoke all on function equipe_do_contrato(uuid, text, date) from public, anon;

-- Troca a chamada dentro do importador sem reescrever as 250 linhas.
-- Se o texto não bater, estoura — silêncio aqui seria pior.
do $$
declare src text; novo text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'importar_toa_interno';

  novo := replace(src,
    'v_equipe  := equipe_do_login(v_base, v_login, v_data);',
    'v_equipe  := equipe_do_contrato(v_base, v_login, v_data);');

  if novo = src then
    raise exception 'Nao achei a chamada a equipe_do_login no importador.';
  end if;

  execute novo;
end $$;

revoke all on function importar_toa_interno(uuid, boolean) from public, anon;

-- Realinha o que já está gravado.
update visita v
   set equipe_id = equipe_do_contrato(v.base_id,
                     v.dados_origem->>'Login do Técnico', v.data_agendada)
 where v.excluido_em is null and v.equipe_id is null
   and nullif(btrim(coalesce(v.dados_origem->>'Login do Técnico','')),'') is not null;

-- Depois disto: 8 no abrigo, 158 sem equipe (todas jornada, que é o certo).
