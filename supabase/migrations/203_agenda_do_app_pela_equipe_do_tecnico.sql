-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 203 — A agenda do app é a da EQUIPE do técnico, mesmo para a gestão   │
-- │                                                                      │
-- │ "o supervisor precisou ir para campo o supervisor pedro de Manaus     │
-- │  (...) quero passar rota pra ele, ele vai usar o app igual ao         │
-- │  técnico, mais ele ainda continua sendo supervisor" — Emanuel, 04/11. │
-- │                                                                      │
-- │ A equipe própria do supervisor já existe (067: SUP-PEDRO, "PEDRO      │
-- │ CAMPOS"). O que faltava: `agenda_do_campo` lia `equipes_visiveis()`,  │
-- │ que para o SUPERVISOR são todas as equipes dele — medido como o       │
-- │ Pedro em 04/11: 8 equipes, 47 contratos na agenda do app.            │
-- │                                                                      │
-- │ Agora: o login ligado a um técnico (`tecnico.usuario_id`) que TEM     │
-- │ equipe vê só os contratos dessa equipe. Para o técnico comum é a      │
-- │ mesma conta de antes (`equipes_visiveis()` dele já é a equipe dele). │
-- │ Sem equipe no técnico, nada muda. Em 04/11 só dois logins de gestão   │
-- │ tinham técnico ligado (Pedro e Adarlan), os dois sem equipe.         │
-- │ Os poderes de supervisor no site não mudam: só a agenda do app.      │
-- │ Sem DDL de tabela; a assinatura é a mesma (create or replace         │
-- │ preserva a ACL).                                                     │
-- └──────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.agenda_do_campo(p_data date DEFAULT NULL::date)
 RETURNS TABLE(visita_id uuid, contrato text, wo_numero text, cliente_nome text, logradouro text, complemento text, bairro text, cep text, node text, telefones text[], lat numeric, lng numeric, janela_inicio time without time zone, janela_fim time without time zone, situacao text, data_agendada date, servico text, os_total integer, os_baixadas integer, evidencias integer, equipamentos integer, pontos numeric, pontos_achou boolean, segmento text, ouvidoria boolean, tec1 text, produtos text[], tipo_atividade text, tecnologia text, observacao_cop text, observacao_cop_em timestamp with time zone, casa_lat double precision, casa_lng double precision, casa_marcado_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with dia as materialized (select coalesce(p_data, hoje_local()) as d),
  escopo as materialized (select minha_empresa() as empresa, (select eh_gestor()) as gestor),
  bases as materialized (select b from bases_visiveis() b),
  equipes_ok as materialized (select e from equipes_visiveis() e),
  -- 203: o login ligado a um técnico COM equipe vê a agenda dessa equipe —
  -- o supervisor que vai a campo não recebe as equipes que supervisiona.
  meu_time as materialized (
    select (select t.equipe_id from tecnico t
             where t.usuario_id = auth.uid() and t.equipe_id is not null
             limit 1) as eq),
  minhas as materialized (
    select v.id, v.contrato, v.wo_numero, v.cliente_nome, v.logradouro,
           v.complemento, v.bairro, v.cep, v.node, v.telefones, v.lat, v.lng,
           v.janela_inicio, v.janela_fim, v.situacao, v.data_agendada,
           coalesce(ts.nome, ta.nome, 'Visita') as servico,
           sg.nome as segmento, v.ouvidoria, v.tec1, v.produtos_pendentes,
           ta.nome as tipo_atividade, v.tecnologia,
           v.observacao_cop, v.observacao_cop_em, v.empresa_id,
           chave_endereco(v.logradouro, v.bairro) as chave
      from visita v
      cross join escopo s
      left join tipo_servico   ts on ts.id = v.tipo_servico_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join segmentacao    sg on sg.id = v.segmentacao_id
     where v.excluido_em is null
       and v.data_agendada = (select d from dia)
       and v.empresa_id = s.empresa
       and v.base_id in (select b from bases)
       and (case when (select eq from meu_time) is not null
                 then v.equipe_id = (select eq from meu_time)
                 else (s.gestor or v.equipe_id in (select e from equipes_ok)) end)
       and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA'
  ),
  pts as materialized (
    select m.id as visita_id, p.pontos_claro, p.achou
      from minhas m cross join lateral pontos_da_visita(m.id) p
  ),
  contagem as materialized (
    select o.visita_id, count(*)::int as total,
           count(*) filter (where o.codigo_baixa_afline_id is not null)::int as baixadas
      from ordem_servico o where o.visita_id in (select id from minhas)
     group by o.visita_id
  ),
  evid as materialized (
    select e.visita_id, count(*)::int as n from evidencia e
     where e.visita_id in (select id from minhas) group by e.visita_id
  ),
  equip as materialized (
    select m.visita_id, count(*)::int as n from equipamento_movimento m
     where m.visita_id in (select id from minhas) group by m.visita_id
  )
  select m.id, m.contrato, m.wo_numero, m.cliente_nome, m.logradouro,
         m.complemento, m.bairro, m.cep, m.node, m.telefones, m.lat, m.lng,
         m.janela_inicio, m.janela_fim, m.situacao, m.data_agendada, m.servico,
         coalesce(c.total, 0), coalesce(c.baixadas, 0),
         coalesce(ev.n, 0), coalesce(eq.n, 0),
         case when p.achou then p.pontos_claro end,
         coalesce(p.achou, false),
         m.segmento, m.ouvidoria, m.tec1, m.produtos_pendentes,
         m.tipo_atividade, m.tecnologia,
         m.observacao_cop, m.observacao_cop_em,
         casa.lat, casa.lng, casa.marcado_em
    from minhas m
    left join pts      p  on p.visita_id  = m.id
    left join contagem c  on c.visita_id  = m.id
    left join evid     ev on ev.visita_id = m.id
    left join equip    eq on eq.visita_id = m.id
    left join lateral (
      select cc.lat, cc.lng, cc.marcado_em from casa_cliente cc
       where cc.empresa_id = m.empresa_id and cc.contrato = m.contrato
         and cc.endereco_chave = m.chave
       order by cc.marcado_em desc limit 1) casa on true
   order by m.janela_inicio nulls last, m.contrato;
$function$;

revoke all on function public.agenda_do_campo(date) from public, anon;
grant execute on function public.agenda_do_campo(date) to authenticated;
