-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 156a · O SUPERVISOR vê a cidade inteira — só olhando             ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "quem pode movimentar a rota sao COP e controlador. Supervisor nao
-- >  tem esse acesso, a nao ser que seja concedido (...) supervisor tem
-- >  o acesso de supervisor, mas nao consegue olhar rota nenhuma do dia.
-- >  Isso ai precisa ser corrigido"  -- Emanuel, 30/10
--
-- Decisao dele (30/10): ve a cidade inteira, so olhando.
--
-- ┌─ por que o supervisor nao via nada ──────────────────────────────┐
-- │ `equipes_visiveis()` da ao supervisor as equipes com            │
-- │ `supervisor_id` = ele. Medido em 30/10: NENHUMA equipe da        │
-- │ empresa, em cidade nenhuma, tem supervisor declarado. Os dois    │
-- │ supervisores de Sao Luis (Flavio, Klebean) enxergavam zero.      │
-- └────────────────────────────────────────────────────────────────────┘
--
-- ┌─ por que NAO foi mexer em `equipes_visiveis()` ───────────────────┐
-- │ A policy `visita_gestao` e `ALL` -- vale para ler E para alterar  │
-- │ e apagar -- e usa `equipes_visiveis()`. Abrir a visao ali daria   │
-- │ ao supervisor UPDATE direto em `visita` pela API: mudar a equipe  │
-- │ do contrato, que e exatamente "mover a rota".                     │
-- │                                                                    │
-- │ Entao a leitura ganhou escopo PROPRIO:                            │
-- │  · `ve_cidade_inteira()` = gestor OU supervisor;                  │
-- │  · `equipes_legiveis()` = todas as equipes da cidade para eles,  │
-- │    as de sempre para os outros;                                   │
-- │  · troca so nas policies de SELECT e nas funcoes que SO LEEM.    │
-- │ Mensagens e rastro ficam de fora: sao conversa e dado pessoal do  │
-- │ tecnico, e "olhar a rota" nao pede isso.                          │
-- └────────────────────────────────────────────────────────────────────┘
--
-- MOVER A ROTA: `transferir_visita` decidia por PAPEL (gestor ou
-- CONTROLADOR) e ignorava a permissao `servicos.transferir` -- entao
-- "conceder ao supervisor" nao funcionaria. Agora vale papel OU a
-- permissao concedida no perfil.
--
-- Medido como o Flavio (authenticated): 103 paradas de Sao Luis na
-- rota, 15 equipes; UPDATE direto 0 linhas; transferir recusado.
-- Cenarios novos em testar_policies (156b).

create or replace function ve_cidade_inteira() returns boolean
language sql stable security definer set search_path = public as $$
  select eh_gestor() or tem_papel('SUPERVISOR');
$$;
revoke all on function ve_cidade_inteira() from public, anon;
grant execute on function ve_cidade_inteira() to authenticated;

create or replace function equipes_legiveis() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from equipe e
   where e.empresa_id = minha_empresa()
     and e.base_id in (select bases_visiveis())
     and ve_cidade_inteira()
  union
  select equipes_visiveis();
$$;
revoke all on function equipes_legiveis() from public, anon;
grant execute on function equipes_legiveis() to authenticated;

-- ---- as policies de LEITURA (escrita intocada) ----
alter policy visita_leitura on visita using (
  (empresa_id = (select minha_empresa())) and (base_id in (select bases_visiveis()))
  and ((select ve_cidade_inteira()) or (equipe_id in (select equipes_legiveis()))));

alter policy visita_produto_leitura on visita_produto using (
  exists (select 1 from visita v where v.id = visita_produto.visita_id
            and v.empresa_id = (select minha_empresa())
            and v.base_id in (select bases_visiveis())
            and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_legiveis())
                 or v.tecnico_responsavel_id = (select meu_tecnico_id()))));

alter policy equipe_leitura on equipe using (
  (empresa_id = (select minha_empresa())) and (id in (select equipes_legiveis())));

alter policy tecnico_leitura on tecnico using (
  (empresa_id = (select minha_empresa())) and (base_id in (select bases_visiveis()))
  and ((usuario_id = (select auth.uid())) or (equipe_id in (select equipes_legiveis()))));

alter policy ets_leitura on equipe_tipo_servico using (equipe_id in (select equipes_legiveis()));
alter policy elt_leitura on equipe_login_toa using (equipe_id in (select equipes_legiveis()));

-- ---- as funcoes que SO LEEM: o atalho do gestor passa a valer para o supervisor ----
-- Substituicao sobre a definicao VIVA (pg_get_functiondef), com conferencia
-- de que cada uma tinha o atalho -- e nao reescrita a partir do arquivo,
-- que pode estar atrasado (D-160).
do $$
declare f text; d text; n int;
begin
  foreach f in array array[
    'rota_do_dia(date)', 'logins_das_equipes(date)', 'monitor_tecnicos(date)',
    'primeira_wo_dia(date,date,text,text[])', 'primeira_wo_grade(date,date,text,text[])',
    'central_do_controle()', 'sinais_do_dia()', 'ritmo_do_dia()'
  ] loop
    d := pg_get_functiondef(f::regprocedure);
    n := (length(d) - length(replace(d, 'eh_gestor() or ', ''))) / length('eh_gestor() or ');
    if n = 0 then raise exception '% nao tem o atalho -- conferir', f; end if;
    d := replace(d, 'eh_gestor() or ', 've_cidade_inteira() or ');
    execute d;
  end loop;
end $$;

-- ---- mover a rota: papel OU permissao concedida ----
do $$
declare d text;
begin
  d := pg_get_functiondef('transferir_visita(uuid,uuid,text)'::regprocedure);
  d := replace(d, 'if not (eh_gestor() or tem_papel(''CONTROLADOR'')) then',
                  'if not (eh_gestor() or tem_papel(''CONTROLADOR'') or tem_permissao(''servicos.transferir'')) then');
  if d !~ 'servicos\.transferir' then raise exception 'transferir_visita: troca nao pegou'; end if;
  execute d;
end $$;

revoke all on function rota_do_dia(date) from public, anon;
revoke all on function logins_das_equipes(date) from public, anon;
revoke all on function monitor_tecnicos(date) from public, anon;
revoke all on function primeira_wo_dia(date,date,text,text[]) from public, anon;
revoke all on function primeira_wo_grade(date,date,text,text[]) from public, anon;
revoke all on function central_do_controle() from public, anon;
revoke all on function sinais_do_dia() from public, anon;
revoke all on function ritmo_do_dia() from public, anon;
revoke all on function transferir_visita(uuid,uuid,text) from public, anon;

notify pgrst, 'reload schema';
