-- ┌─ 124 · a agenda do técnico mostra o que o controlador vê ───────────┐
-- │ > "esta faltando a visão para o técnico do produto, o segmento do  │
-- │ >  cliente se é PME ou não, a sinalização de ouvidoria técnico tem │
-- │ >  que visualizar também, e na tela principal de cada contrato     │
-- │ >  podemos colocar se perdeu tec1 ou não" — Emanuel, 21/10         │
-- │                                                                    │
-- │ Nada novo é calculado aqui: são as MESMAS colunas que a linha do   │
-- │ contrato da web lê (SELECT_CONTRATO), para o celular e a central   │
-- │ não dizerem coisas diferentes do mesmo contrato:                   │
-- │   segmento  ← segmentacao.nome via visita.segmentacao_id (123b)    │
-- │   ouvidoria ← visita.ouvidoria (123; NULA = a linha não trouxe)    │
-- │   tec1      ← visita.tec1 (PADRAO / SEM_PADRAO / EXPURGADA; nulo = │
-- │               ainda não encerrado no TOA, a regra não se aplica)   │
-- │   produtos  ← visita.produtos_pendentes (um por O.S., D-107)       │
-- │                                                                    │
-- │ Medido em 21/10 (produtivas de hoje): PME 33, PURPLE PME PF 4,     │
-- │ TEC1 sem padrão 6, ouvidoria 1 (de 468 visitas do dia).            │
-- │                                                                    │
-- │ `returns table` ganhou colunas → não cabe `create or replace`      │
-- │ (traps.md): derruba e recria, e a ACL volta a ser fechada à mão.   │
-- │ O corpo é o da função VIVA (pg_get_functiondef em 21/10), só com   │
-- │ as colunas novas.                                                  │
-- └────────────────────────────────────────────────────────────────────┘

drop function if exists public.agenda_do_campo(date);

create function public.agenda_do_campo(p_data date default null)
returns table(
  visita_id uuid, contrato text, wo_numero text, cliente_nome text,
  logradouro text, complemento text, bairro text, cep text, node text,
  telefones text[], lat numeric, lng numeric,
  janela_inicio time, janela_fim time, situacao text, data_agendada date,
  servico text, os_total integer, os_baixadas integer, evidencias integer,
  equipamentos integer, pontos numeric, pontos_achou boolean,
  segmento text, ouvidoria boolean, tec1 text, produtos text[]
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with dia as materialized (select coalesce(p_data, hoje_local()) as d),
  escopo as materialized (select minha_empresa() as empresa, eh_gestor() as gestor),
  bases as materialized (select b from bases_visiveis() b),
  equipes_ok as materialized (select e from equipes_visiveis() e),
  minhas as materialized (
    select v.id, v.contrato, v.wo_numero, v.cliente_nome, v.logradouro,
           v.complemento, v.bairro, v.cep, v.node, v.telefones, v.lat, v.lng,
           v.janela_inicio, v.janela_fim, v.situacao, v.data_agendada,
           coalesce(ts.nome, ta.nome, 'Visita') as servico,
           sg.nome as segmento, v.ouvidoria, v.tec1, v.produtos_pendentes
      from visita v
      cross join escopo s
      left join tipo_servico   ts on ts.id = v.tipo_servico_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join segmentacao    sg on sg.id = v.segmentacao_id
     where v.excluido_em is null
       and v.data_agendada = (select d from dia)
       and v.empresa_id = s.empresa
       and v.base_id in (select b from bases)
       and (s.gestor or v.equipe_id in (select e from equipes_ok))
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
         m.segmento, m.ouvidoria, m.tec1, m.produtos_pendentes
    from minhas m
    left join pts      p  on p.visita_id  = m.id
    left join contagem c  on c.visita_id  = m.id
    left join evid     ev on ev.visita_id = m.id
    left join equip    eq on eq.visita_id = m.id
   order by m.janela_inicio nulls last, m.contrato;
$function$;

-- Função recriada do zero nasce aberta ao anon (security.md).
revoke all on function public.agenda_do_campo(date) from public, anon;
grant execute on function public.agenda_do_campo(date) to authenticated, service_role;

notify pgrst, 'reload schema';
