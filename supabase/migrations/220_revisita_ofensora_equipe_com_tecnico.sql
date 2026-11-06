-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 220 — Revisita ofensora: a equipe com o técnico embaixo (D-328)       │
-- │                                                                      │
-- │ "115 e LUIS é a mesma coisa (...) mostre o número da equipe e o nome │
-- │  do técnico embaixo, você colocou o 115 em um lugar e o nome dele em │
-- │  outro sendo que ele é um só. 113 também é o Fagner, por que não tem │
-- │  o nome?" — Emanuel, 06/11. Revê a 219 (D-327).                      │
-- │                                                                      │
-- │ A linha passa a ser a EQUIPE do serviço anterior (pelo id). O nome   │
-- │ embaixo é o técnico registrado na visita anterior; quando não há     │
-- │ (o histórico do ngestor trouxe só a equipe, D-282), é o técnico      │
-- │ ATIVO cadastrado na equipe — o Emanuel afirmou que a equipe é a      │
-- │ pessoa. Por id e não por código: "113" existe em Manaus (FAGNER) e   │
-- │ em São Luís (AGIVALDO). A resposta diz de onde veio o nome            │
-- │ (`nome_do_cadastro`), e cada item traz o técnico registrado dele.    │
-- └──────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.dashboard_visita_tecnica(p_dia date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_dia date := coalesce(p_dia, hoje_local());
  v_dias_mes int := extract(day from (date_trunc('month', coalesce(p_dia, hoje_local()))
                                      + interval '1 month - 1 day'))::int;
  v_terminais text[] := situacoes_terminais();
  -- 217: o mínimo de contratos no dia para ser equipe de VT (Emanuel, 06/11)
  v_min_vt int := 4;
  v_out jsonb;
begin
  with vt as materialized (
    select v.id, v.contrato, v.situacao, v.equipe_id, v.area_id, v.tecnico_responsavel_id,
           -- 217: janela e endereço (a rua é chave só para comparar; ver o cabeçalho)
           v.janela_inicio, v.janela_fim, v.logradouro, v.complemento, v.bairro,
           coalesce(nullif(btrim(v.node), ''), nullif(btrim(v.dados_origem->>'Node'), '')) as node,
           case when btrim(coalesce(v.dados_origem->>'Contador de log', '')) ~ '^\d+(\.\d+)?$'
                then trunc(btrim(v.dados_origem->>'Contador de log')::numeric)::int end as log,
           -- Auditar = o desatribuído (800 na baixa da AFLINE), como origemCancelada() na web
           (v.situacao = 'CANCELADA' and exists (
              select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
               where o.visita_id = v.id and cb.codigo = 800)) as auditar,
           (v.situacao = 'CANCELADA'
            and (v.cancelado_central_em is not null
                 or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                           v.dados_origem->>'Motivo de Fechamento Externo'))) as central_bruto,
           -- 216 (D-323): o TOA cancelou pela central, mesmo que o contrato siga Em execução
           -- aqui por ter tido movimento (189, D-278)
           (v.cancelado_central_em is not null
            or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                      v.dados_origem->>'Motivo de Fechamento Externo')) as central_toa
      from visita v
      join tipo_servico g on g.id = v.tipo_servico_id and g.nome = 'VISITA TECNICA'
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.data_agendada = v_dia
       and v.excluido_em is null
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and coalesce(ta.natureza, '') <> 'JORNADA'
  ),
  vt2 as materialized (
    -- a ordem da web: o 800 primeiro, depois o cancelado pela central
    select vt.*, (not vt.auditar and vt.central_bruto) as central from vt
  ),
  conta as materialized (select * from vt2 where not auditar and not central),
  -- 216 (D-323): o AT1 tira também o que o TOA cancelou pela central (inclusive o que
  -- segue Em execução aqui) e qualquer outro Cancelado.
  conta_at1 as materialized (select * from conta where not central_toa and situacao <> 'CANCELADA'),
  -- O código do contrato: as O.S. com baixa do TOA; sem nenhuma, as da AFLINE.
  codos as materialized (
    select c.id as visita_id, o.id as os_id, o.sub_falha_id,
           case when exists (select 1 from ordem_servico x where x.visita_id = c.id and x.codigo_baixa_id is not null)
                then o.codigo_baixa_id else o.codigo_baixa_afline_id end as cb_id,
           case when exists (select 1 from ordem_servico x where x.visita_id = c.id and x.codigo_baixa_id is not null)
                then 'TOA' else 'AFLINE' end as fonte
      from conta c join ordem_servico o on o.visita_id = c.id
  ),
  cod_contrato as materialized (
    select k.visita_id, cb.codigo, cb.descricao, cb.natureza, min(k.fonte) as fonte,
           (array_agg(sf.nome order by sf.nome) filter (where sf.nome is not null))[1] as sub_falha
      from codos k
      join codigo_baixa cb on cb.id = k.cb_id
      left join sub_falha sf on sf.id = k.sub_falha_id
     group by k.visita_id, cb.codigo, cb.descricao, cb.natureza
  ),
  resultado as materialized (
    select c.id, c.equipe_id, c.situacao,
           case when exists (select 1 from cod_contrato k where k.visita_id = c.id and k.natureza = 'IMPRODUTIVA') then 'NAO_EXECUTADO'
                when exists (select 1 from cod_contrato k where k.visita_id = c.id and k.natureza = 'SUCESSO') then 'EXECUTADO'
                when not (c.situacao = any (v_terminais)) then 'EM_ABERTO'
                else 'OUTRO' end as st
      from conta c
  ),
  -- 217: a equipe de VT — 4 ou mais contratos no dia, ou de MANUTENÇÃO com qualquer número.
  eq_vt as materialized (
    select c.equipe_id, count(*)::int as n,
           (exists (select 1 from tecnico t
                     where t.equipe_id = c.equipe_id and t.situacao = 'ATIVO'
                       and norm_txt(t.skill) = 'MANUTENCAO')
            or bool_or(exists (select 1 from tecnico t
                                where t.id = c.tecnico_responsavel_id
                                  and norm_txt(t.skill) = 'MANUTENCAO'))) as manut
      from conta c
     where c.equipe_id is not null
     group by c.equipe_id
  ),
  jan as materialized (
    select c.id, c.equipe_id,
           coalesce((select q.n >= v_min_vt or q.manut from eq_vt q where q.equipe_id = c.equipe_id), false) as entra,
           case when c.janela_inicio is null or c.janela_fim is null then 'sem janela'
                else regexp_replace(to_char(c.janela_inicio, 'HH24:MI'), ':00$', '') || '–'
                     || regexp_replace(to_char(c.janela_fim, 'HH24:MI'), ':00$', '') end as janela,
           coalesce(c.janela_inicio, time '23:59') as o_ini,
           coalesce(c.janela_fim, time '23:59') as o_fim,
           coalesce(nullif(ar.apelido, ''), ar.codigo, 'sem área') as area
      from conta c
      left join area_trabalho ar on ar.id = c.area_id
  ),
  matriz as materialized (
    select janela, area, grouping(janela) as gj, grouping(area) as ga,
           min(o_ini) as o_ini, min(o_fim) as o_fim,
           count(*)::int as vt,
           count(*) filter (where entra)::int as vt_eq,
           count(distinct equipe_id) filter (where entra)::int as equipes
      from jan
     group by grouping sets ((janela, area), (janela), (area), ())
  ),
  tec1 as materialized (
    select tec1_da_os(o.id) as cl
      from conta c join ordem_servico o on o.visita_id = c.id
  ),
  rev as materialized (
    select r.*, c.contrato
      from revisita_dos_contratos(
             (select coalesce(array_agg(id), '{}') from conta where contrato is not null)) r
      join conta c on c.id = r.visita_id
     where r.revisita
  ),
  areas as materialized (
    select a.id, a.codigo, coalesce(nullif(a.apelido, ''), a.codigo) as rotulo,
           (select b.clientes from base_clientes_area b
             where b.area_id = a.id and b.vigencia_inicio <= v_dia
             order by b.vigencia_inicio desc limit 1) as clientes,
           (select b.vigencia_inicio from base_clientes_area b
             where b.area_id = a.id and b.vigencia_inicio <= v_dia
             order by b.vigencia_inicio desc limit 1) as desde,
           (select count(*) from conta_at1 c where c.area_id = a.id)::int as vt
      from area_trabalho a
     where a.base_id in (select bases_visiveis())
       and (a.ativo or exists (select 1 from conta_at1 c where c.area_id = a.id))
  ),
  at1 as (
    select coalesce(sum(vt) filter (where clientes is not null), 0)::int as vt_com_base,
           sum(clientes)::bigint as base,
           (coalesce(sum(vt) filter (where clientes is null), 0)
            + (select count(*) from conta_at1 c where c.area_id is null
                  or c.area_id not in (select id from areas)))::int as vt_sem_base
      from areas
  )
  select jsonb_build_object(
    'dia', v_dia,
    'dias_mes', v_dias_mes,
    'total', (select count(*) from vt2),
    'auditar', (select count(*) from vt2 where auditar),
    'cancelado_central', (select count(*) from vt2 where central),
    'volume', (select count(*) from conta),
    'volume_at1', (select count(*) from conta_at1),
    'log', (select jsonb_build_object(
              'base', count(*) filter (where log is not null),
              'sem_log', count(*) filter (where log is null),
              'log3', count(*) filter (where log >= 3),
              'log0', count(*) filter (where log = 0),
              'por_log', coalesce((select jsonb_agg(jsonb_build_object('log', l, 'n', n) order by l)
                                     from (select least(log, 3) l, count(*) n from vt2
                                            where not auditar and log is not null group by 1) q), '[]'))
              from vt2 where not auditar),
    'tec1', (select jsonb_build_object(
              'padrao', count(*) filter (where cl = 'PADRAO'),
              'sem_padrao', count(*) filter (where cl = 'SEM_PADRAO'),
              'expurgada', count(*) filter (where cl = 'EXPURGADA'),
              'em_aberto', count(*) filter (where cl is null)) from tec1),
    'at1', (select jsonb_build_object('vt_com_base', vt_com_base, 'base', base,
                                      'vt_sem_base', vt_sem_base) from at1),
    'areas', coalesce((select jsonb_agg(jsonb_build_object(
                'area_id', id, 'codigo', codigo, 'rotulo', rotulo, 'clientes', clientes,
                'desde', desde, 'vt', vt) order by rotulo) from areas), '[]'),
    'equipes', coalesce((select jsonb_agg(x order by (x->>'executados')::int desc, x->>'rotulo') from (
                select jsonb_build_object(
                  'equipe_id', r.equipe_id, 'codigo', e.codigo, 'nome', e.nome,
                  'executados', count(*) filter (where r.st = 'EXECUTADO'),
                  'nao_executados', count(*) filter (where r.st = 'NAO_EXECUTADO'),
                  'em_aberto', count(*) filter (where r.st = 'EM_ABERTO'),
                  'outros', count(*) filter (where r.st = 'OUTRO'),
                  'total', count(*), 'rotulo', coalesce(e.codigo, ''),
                  -- 217: se ela entra como equipe de VT
                  'equipe_vt', coalesce(bool_or(q.n >= v_min_vt or q.manut), false)) as x
                  from resultado r left join equipe e on e.id = r.equipe_id
                  left join eq_vt q on q.equipe_id = r.equipe_id
                 group by r.equipe_id, e.codigo, e.nome) q), '[]'),
    'revisita', jsonb_build_object(
       'total', (select count(*) from rev),
       -- 220 (D-328): uma linha por EQUIPE do serviço anterior, com o técnico embaixo.
       -- O nome é o registrado na visita anterior; sem ele (histórico do ngestor, D-282),
       -- o técnico ATIVO cadastrado na equipe (pelo id — o código 113 existe em duas cidades).
       'tecnicos', coalesce((select jsonb_agg(jsonb_build_object(
            'tecnico', coalesce(q.registrados, q.do_cadastro, ''), 'equipe', q.eq,
            'nome_do_cadastro', q.registrados is null and q.do_cadastro is not null,
            'n', q.n, 'itens', q.itens) order by q.n desc, q.eq) from (
            select g.eq, g.n, g.itens, g.registrados,
                   (select string_agg(t.nome, ' / ' order by t.nome) from tecnico t
                     where t.equipe_id = g.equipe_id and t.situacao = 'ATIVO') as do_cadastro
              from (
                select a.equipe_id, max(rv.anterior_equipe) as eq, count(*) as n,
                       string_agg(distinct rv.anterior_tecnico, ' / ') as registrados,
                       jsonb_agg(jsonb_build_object('visita_id', rv.visita_id, 'contrato', rv.contrato,
                         'anterior_id', rv.anterior_id, 'anterior_data', rv.anterior_data,
                         'anterior_grupo', rv.anterior_grupo, 'dias', rv.dias,
                         'anterior_tecnico', rv.anterior_tecnico,
                         'baixa', case when rv.anterior_baixa_codigo is null then null
                                       else rv.anterior_baixa_codigo || ' - ' || rv.anterior_baixa_descricao end)
                         order by rv.dias) as itens
                  from rev rv
                  left join visita a on a.id = rv.anterior_id
                 group by a.equipe_id) g) q), '[]')),
    'nodes', jsonb_build_object(
       'distintos', (select count(distinct node) from conta),
       'sem_node', (select count(*) from conta where node is null),
       'lista', coalesce((select jsonb_agg(jsonb_build_object(
            'node', node, 'n', n, 'log3', log3, 'nao_executados', nao, 'itens', itens) order by n desc, node) from (
            select c.node, count(*) as n,
                   count(*) filter (where c.log >= 3) as log3,
                   count(*) filter (where r.st = 'NAO_EXECUTADO') as nao,
                   jsonb_agg(jsonb_build_object('visita_id', c.id, 'contrato', c.contrato, 'log', c.log)
                             order by c.log desc nulls last) as itens
              from conta c join resultado r on r.id = c.id
             where c.node is not null
             group by c.node
             order by count(*) desc, c.node
             limit 15) q), '[]')),
    'codigos', jsonb_build_object(
       'contratos_com_baixa', (select count(distinct visita_id) from cod_contrato),
       'sem_baixa', (select count(*) from conta c where not exists (select 1 from cod_contrato k where k.visita_id = c.id)),
       'lista', coalesce((select jsonb_agg(jsonb_build_object(
            'codigo', codigo, 'descricao', descricao, 'natureza', natureza, 'n', n,
            'pelo_afline', afl, 'sub_falhas', sfs, 'itens', itens) order by n desc, codigo) from (
            select k.codigo, k.descricao, k.natureza, count(*) as n,
                   count(*) filter (where k.fonte = 'AFLINE') as afl,
                   (select jsonb_agg(jsonb_build_object('sub_falha', s, 'n', m) order by m desc, s nulls last)
                      from (select k2.sub_falha as s, count(*) as m from cod_contrato k2
                             where k2.codigo = k.codigo group by k2.sub_falha) z) as sfs,
                   jsonb_agg(jsonb_build_object('visita_id', k.visita_id, 'contrato', c.contrato,
                                                'sub_falha', k.sub_falha, 'fonte', k.fonte)
                             order by c.contrato) as itens
              from cod_contrato k join conta c on c.id = k.visita_id
             group by k.codigo, k.descricao, k.natureza) q), '[]')),
    -- 217: a equipe de VT e a média
    'equipes_vt', jsonb_build_object(
       'minimo', v_min_vt,
       'equipes', (select count(*) from eq_vt where n >= v_min_vt or manut),
       'por_manutencao', (select count(*) from eq_vt where n < v_min_vt and manut),
       'vt', (select coalesce(sum(n), 0) from eq_vt where n >= v_min_vt or manut),
       'sem_equipe', (select count(*) from conta where equipe_id is null),
       'fora', coalesce((select jsonb_agg(jsonb_build_object(
            'equipe_id', q.equipe_id, 'codigo', e.codigo, 'nome', e.nome, 'n', q.n,
            'itens', (select jsonb_agg(jsonb_build_object('visita_id', c.id, 'contrato', c.contrato)
                                       order by c.contrato)
                        from conta c where c.equipe_id = q.equipe_id))
            order by q.n desc, e.codigo)
          from eq_vt q left join equipe e on e.id = q.equipe_id
         where not (q.n >= v_min_vt or q.manut)), '[]')),
    -- 217: VT por janela × área (gj/ga = 1 marca a linha de total)
    'janelas', coalesce((select jsonb_agg(jsonb_build_object(
            'janela', janela, 'area', area, 'total_janela', ga = 1, 'total_area', gj = 1,
            'vt', vt, 'vt_eq', vt_eq, 'equipes', equipes)
            order by gj, o_ini, o_fim, janela, ga, area) from matriz), '[]'),
    -- 217: LOG, endereço e a chave da rua, por contrato do universo
    'contratos', coalesce((select jsonb_object_agg(c.id, jsonb_build_object(
            'log', c.log,
            'endereco', nullif(btrim(c.logradouro), ''),
            'complemento', nullif(btrim(c.complemento, ' ,'), ''),
            'bairro', nullif(btrim(c.bairro), ''),
            'rua', case when nullif(btrim(c.logradouro), '') is null then null
                        else norm_txt(split_part(c.logradouro, ',', 1)) || '|' || norm_txt(c.bairro) end))
          from conta c), '{}')
  ) into v_out;

  return v_out;
end $function$;

revoke all on function public.dashboard_visita_tecnica(date) from public, anon;
grant execute on function public.dashboard_visita_tecnica(date) to authenticated;
