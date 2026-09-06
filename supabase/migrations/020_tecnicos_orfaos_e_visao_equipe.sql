-- Recursos vistos em campo mas fora do cadastro, e visao de equipe
--
-- A planilha de equipes envelhece: recurso criado depois dela aparece
-- trabalhando no TOA sem estar cadastrado. Isso virava "sem equipe"
-- silencioso no painel. Passa a ser um aviso acionavel.
--
-- NOTA: tecnicos_nao_cadastrados() e substituida em 021, que passa a
-- considerar tambem o login da EQUIPE. Ver a versao final no banco.

create or replace function cadastrar_tecnico_avulso(
  p_matricula text, p_nome text, p_equipe_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_emp uuid; v_base uuid; v_tec uuid; n int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  v_emp := minha_empresa();

  if p_equipe_id is not null then
    select base_id into v_base from equipe
     where id = p_equipe_id and empresa_id = v_emp;
    if v_base is null then
      raise exception 'Equipe nao encontrada nesta empresa.';
    end if;
  else
    select id into v_base from base
     where empresa_id = v_emp and id in (select bases_visiveis()) limit 1;
  end if;

  insert into tecnico (empresa_id, base_id, matricula, nome, equipe_id)
  values (v_emp, v_base, upper(btrim(p_matricula)),
          coalesce(nullif(btrim(p_nome), ''), upper(btrim(p_matricula))), p_equipe_id)
  on conflict (base_id, matricula) do update
    set nome = excluded.nome,
        equipe_id = coalesce(excluded.equipe_id, tecnico.equipe_id)
  returning id into v_tec;

  update visita v
     set tecnico_responsavel_id = v_tec,
         equipe_id = coalesce(p_equipe_id, v.equipe_id)
   where v.base_id = v_base
     and v.tecnico_responsavel_id is null
     and norm_txt(v.dados_origem ->> 'Login do T\u00e9cnico') = norm_txt(p_matricula);
  get diagnostics n = row_count;

  return jsonb_build_object('tecnico_id', v_tec, 'visitas_religadas', n);
end;
$fn$;

-- Uma linha por equipe, com o que o controlador precisa para decidir despacho.
create or replace view vw_equipe_resumo
with (security_invoker = true) as
select
  e.id, e.empresa_id, e.base_id, e.codigo, e.nome, e.ativo,
  e.supervisor_nome, norm_supervisor(e.supervisor_nome) as supervisor,
  a.codigo as area_codigo, a.apelido as area,
  (select count(*) from tecnico t where t.equipe_id = e.id
     and t.situacao = 'ATIVO') as tecnicos,
  (select count(*) from visita v where v.equipe_id = e.id
     and v.data_agendada = current_date) as visitas_hoje,
  (select count(*) from visita v where v.equipe_id = e.id
     and v.data_agendada = current_date and v.situacao = 'CONCLUIDA') as concluidas_hoje,
  (select count(*) from visita v where v.equipe_id = e.id
     and v.data_agendada = current_date
     and v.situacao not in ('CONCLUIDA','CANCELADA')) as abertas_hoje,
  (select max(v.data_agendada) from visita v where v.equipe_id = e.id) as ultima_atividade
from equipe e
left join area_trabalho a on a.id = e.area_id;

revoke execute on function cadastrar_tecnico_avulso(text, text, uuid) from public, anon;
grant execute on function cadastrar_tecnico_avulso(text, text, uuid) to authenticated;
