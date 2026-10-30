-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155f/g · Monitoramento e conversas: só a CIDADE ATIVA            ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "nessa tela de monitoramento e bom mostrar os tecnicos da cidade,
-- >  apenas"  -- Emanuel, 29/10
--
-- Mesma causa da 155b: o `eh_gestor() or` curto-circuitava o filtro de
-- cidade. Com Manaus ativa, o mapa mostrava o Emmanuel em Sao Luis.
--
-- Depois de documentar a armadilha, varri o banco: 18 funcoes SECURITY
-- DEFINER tem `eh_gestor() or` sem `bases_visiveis`. Entraram aqui so as
-- duas que MOSTRAM coisa na central ou no monitoramento:
--   · monitor_tecnicos   (aplicada como 155f)
--   · conversas_do_controle -- o balao de mensagens da central tambem e
--     notificacao (aplicada como 155g)
-- As outras 16 sao checagem de permissao ou escrita (excluir_visita,
-- importar_toa, enviar_mensagem...) ou telas do almoxarifado
-- (estoque_posicao, miscelanea_saldos). Mexer nelas e outra conversa,
-- e fica registrado na D-235 como pendente.

-- ---------------------------------------------------------------- --
--  155f · monitor_tecnicos
-- ---------------------------------------------------------------- --
create or replace function monitor_tecnicos(p_data date)
returns table(tecnico_id uuid, nome text, matricula text, equipe_id uuid, equipe_codigo text, equipe_nome text, placa text, pontos integer, primeiro_em timestamp with time zone, ultimo_em timestamp with time zone, ultimo_lat double precision, ultimo_lng double precision, ultimo_precisao real, ultimo_motivo text, bateria smallint, km numeric, contrato_ativo text, situacao_ativa text, visita_ativa uuid, contratos integer, encerrados integer, baixas_campo integer, baixas_fora integer, gps_estado text, gps_desde timestamp with time zone, aparelho_modificado boolean, ciencia_em timestamp with time zone, fora_de_area text, na_garagem text, alertas_gps integer)
language plpgsql stable security definer set search_path to 'public' as $function$
#variable_conflict use_column
declare v_ini timestamptz; v_fim timestamptz; v_raio integer;
begin
  if not eh_gestao() then
    raise exception 'Monitoramento e do controle.' using errcode = '42501';
  end if;
  v_ini := (p_data::timestamp) at time zone 'America/Manaus';
  v_fim := ((p_data + 1)::timestamp) at time zone 'America/Manaus';
  select coalesce((valor #>> '{}')::integer, 200) into v_raio
    from parametro where empresa_id = minha_empresa() and chave = 'raio_baixa_m';
  v_raio := coalesce(v_raio, 200);

  return query
  with tec as materialized (
    select t.id, t.nome, t.matricula, t.equipe_id, e.codigo, e.nome as enome, t.usuario_id
      from tecnico t
      left join equipe e on e.id = t.equipe_id
     where t.empresa_id = minha_empresa()
       and t.situacao = 'ATIVO'
       -- 155f: a cidade ATIVA, antes do atalho do gestor (traps.md).
       and t.base_id in (select bases_visiveis())
       and (eh_gestor() or t.equipe_id in (select equipes_visiveis()))
  ),
  pt as materialized (
    select r.tecnico_id, r.capturado_em, r.lat, r.lng, r.precisao_m, r.motivo, r.bateria,
           lag(r.lat) over w as plat, lag(r.lng) over w as plng,
           lag(r.precisao_m) over w as pprec,
           row_number() over (partition by r.tecnico_id order by r.capturado_em desc) as rn
      from rastro_ponto r
     where r.tecnico_id in (select id from tec)
       and r.capturado_em >= v_ini and r.capturado_em < v_fim
       and not r.simulado
    window w as (partition by r.tecnico_id order by r.capturado_em)
  ),
  resumo as (
    select p.tecnico_id,
           count(*)::integer as n,
           min(p.capturado_em) as prim,
           max(p.capturado_em) as ult,
           round(coalesce(sum(d.m) filter (
             where d.m >= 25 and coalesce(p.precisao_m, 0) <= 100
               and coalesce(p.pprec, 0) <= 100), 0) / 1000.0, 1) as km
      from pt p
      cross join lateral (select distancia_m(p.plat, p.plng, p.lat, p.lng) as m) d
     group by p.tecnico_id
  ),
  vis as materialized (
    select v.id, v.contrato, v.situacao, v.equipe_id, v.tecnico_responsavel_id, v.situacao_em
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.data_agendada = p_data and v.excluido_em is null
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and v.equipe_id in (select tec.equipe_id from tec)
  ),
  loc as materialized (
    select e.tecnico_id,
           count(*)::integer as n,
           count(*) filter (where distancia_m(e.lat::double precision, e.lng::double precision,
                                              v.lat::double precision, v.lng::double precision) > v_raio)::integer as fora
      from visita_evento e
      join visita v on v.id = e.visita_id
     where e.visita_id in (select id from vis)
       and e.origem = 'MOBILE' and e.lat is not null
       and (e.tipo = 'BAIXA'
            or (e.tipo = 'SITUACAO' and e.para->>'situacao' = any (situacoes_terminais())))
     group by e.tecnico_id
  )
  select t.id, t.nome, t.matricula, t.equipe_id, t.codigo, t.enome,
         (select vc.placa from veiculo_condutor c join veiculo vc on vc.id = c.veiculo_id
           where c.tecnico_id = t.id and c.ate is null and vc.arquivado_em is null
           order by c.desde desc limit 1),
         coalesce(r.n, 0), r.prim, r.ult,
         u.lat, u.lng, u.precisao_m, u.motivo, u.bateria,
         coalesce(r.km, 0),
         a.contrato, a.situacao, a.id,
         (select count(*)::integer from vis x
           where x.tecnico_responsavel_id = t.id
              or (x.tecnico_responsavel_id is null and x.equipe_id = t.equipe_id)),
         (select count(*)::integer from vis x
           where (x.tecnico_responsavel_id = t.id
                  or (x.tecnico_responsavel_id is null and x.equipe_id = t.equipe_id))
             and x.situacao = any (situacoes_terminais())),
         coalesce(l.n, 0), coalesce(l.fora, 0),
         coalesce(g.estado, 'NORMAL'), g.desde, coalesce(g.aparelho_modificado, false),
         (select max(ci.aceito_em) from ciencia_rastro ci where ci.usuario_id = t.usuario_id),
         (select string_agg(ce.nome, ', ') from cerca_estado st join cerca ce on ce.id = st.cerca_id
           where st.tecnico_id = t.id and not st.dentro and ce.tipo = 'AREA'
             and ce.arquivado_em is null and ce.alerta_sair),
         (select string_agg(ce.nome, ', ') from cerca_estado st join cerca ce on ce.id = st.cerca_id
           where st.tecnico_id = t.id and st.dentro and ce.tipo = 'GARAGEM' and ce.arquivado_em is null),
         (select count(*)::integer from gps_alerta ga
           where ga.tecnico_id = t.id and ga.em >= v_ini and ga.em < v_fim and ga.tipo <> 'NORMALIZADO')
    from tec t
    left join resumo r on r.tecnico_id = t.id
    left join pt u on u.tecnico_id = t.id and u.rn = 1
    left join tecnico_gps g on g.tecnico_id = t.id
    left join lateral (
      select x.id, x.contrato, x.situacao from vis x
       where x.situacao in ('EM_DESLOCAMENTO', 'EM_EXECUCAO')
         and (x.tecnico_responsavel_id = t.id
              or (x.tecnico_responsavel_id is null and x.equipe_id = t.equipe_id))
       order by x.situacao_em desc nulls last limit 1) a on true
    left join loc l on l.tecnico_id = t.id
   where r.n is not null or l.n is not null
      or exists (select 1 from vis x where x.equipe_id = t.equipe_id)
      or exists (select 1 from gps_alerta ga where ga.tecnico_id = t.id and ga.em >= v_ini and ga.em < v_fim);
end;
$function$;

revoke all on function monitor_tecnicos(date) from public, anon;
grant execute on function monitor_tecnicos(date) to authenticated;

-- ---------------------------------------------------------------- --
--  155g · conversas_do_controle
-- ---------------------------------------------------------------- --
create or replace function conversas_do_controle()
returns table(tecnico_id uuid, nome text, equipe text, tem_app boolean, ultima_texto text, ultima_em timestamp with time zone, ultima_do_campo boolean, nao_lidas bigint)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not eh_gestao() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  return query
    with visiveis as materialized (
      select t.id from tecnico t
       where t.empresa_id = minha_empresa()
         -- 155g: a cidade ATIVA, antes do atalho do gestor (traps.md).
         and t.base_id in (select bases_visiveis())
         and (eh_gestor() or t.equipe_id in (select equipes_visiveis()))
    ),
    ult as (
      select distinct on (m.tecnico_id) m.tecnico_id, m.texto, m.criado_em, m.do_campo
        from mensagem m where m.tecnico_id in (select id from visiveis)
       order by m.tecnico_id, m.criado_em desc
    )
    select t.id, t.nome, e.codigo, t.usuario_id is not null,
           u.texto, u.criado_em, u.do_campo,
           (select count(*) from mensagem m
             where m.tecnico_id = t.id and m.do_campo and m.lida_em is null)
      from ult u
      join tecnico t on t.id = u.tecnico_id
      left join equipe e on e.id = t.equipe_id
     order by u.criado_em desc;
end;
$function$;

revoke all on function conversas_do_controle() from public, anon;
grant execute on function conversas_do_controle() to authenticated;

notify pgrst, 'reload schema';
