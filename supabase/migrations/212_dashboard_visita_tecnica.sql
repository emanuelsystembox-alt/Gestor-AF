-- ============================================================================
-- 212 · Dashboard Visita Técnica — os indicadores do dia da VT, e a base de
--       clientes por área que o AT1 precisa
-- ============================================================================
--
-- > "Vamos criar um Dashboard Visita Técnica abaixo do principal. Nesse
-- >  dashboard vamos ter gráficos intuitivos e direcionados para o resultado
-- >  (...) vamos monitorar as visitas, quero aprimorar o controle."
-- >  — Emanuel, 05/11
--
-- ┌─ o que cada número é (as regras dele, 05/11) ─────────────────────────────┐
-- │ Universo: contratos do grupo VISITA TECNICA no dia de atuação, da cidade  │
-- │ ativa (bases_visiveis()), sem jornada e sem excluído.                     │
-- │                                                                            │
-- │ · LOG  = contratos com LOG 3 ou mais ÷ total. "Retirando o Auditar da     │
-- │         conta apenas" — o cancelado pela central FICA. Corte em 3,        │
-- │         perguntado. LOG vazio na planilha não é LOG 0: fica fora do       │
-- │         denominador e volta contado à parte (regra 6; o mesmo do card     │
-- │         de LOG do Dashboard, metricas.ts).                                │
-- │ · AT5  = contratos em LOG 0 ÷ a mesma base do LOG.                        │
-- │ · AT1  = volume de VT do dia ÷ base de clientes das áreas. Projetada =    │
-- │         VT de hoje × dias do mês ÷ base ("só o dia", escolha dele).       │
-- │         Volume: fora Auditar e fora Cancelado pela central. VT em área    │
-- │         SEM base cadastrada não entra no numerador (o denominador não a   │
-- │         cobre) e volta contada à parte — senão o AT1 sairia inflado.      │
-- │ · TEC1 = a regra de sempre (tec1_da_os, D-187), por O.S., só da VT, sobre │
-- │         o mesmo universo do Dashboard (fora Auditar e Cancelado central). │
-- │                                                                            │
-- │ Os ofensores (executadas por equipe, revisita, node, código de baixa)     │
-- │ usam o universo do AT1: o que ninguém foi fazer não ofende ninguém.       │
-- │                                                                            │
-- │ Código de baixa do contrato: o do TOA; o contrato que NÃO tem nenhuma     │
-- │ baixa do TOA usa a da AFLINE (a "baixa ngestor", Emanuel). Contrato com   │
-- │ dois códigos diferentes entra uma vez em cada (155, como no Dashboard:     │
-- │ contrato, não O.S.).                                                       │
-- │                                                                            │
-- │ Revisita: revisita_dos_contratos() (D-245) — não reescrevo a regra.       │
-- │ Conta para quem fez o serviço ANTERIOR (o técnico da visita anterior).    │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- A base de clientes tem VIGÊNCIA (como a meta da skill, D-167): trocar o
-- número não reescreve o AT1 dos dias que já passaram. A base que vale num dia
-- é a de maior `vigencia_inicio` até ele. Área sem nenhuma: "sem base" na tela,
-- nunca zero.
--
-- Uma RPC só, INVOKER: o RLS de `visita` já é o escopo (cidade + equipes
-- legíveis); a função não precisa de poder nenhum além do de quem chama.
-- ============================================================================

-- ---------------------------------------------------------------- a tabela --
create table if not exists base_clientes_area (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresa(id),
  base_id         uuid not null references base(id),
  area_id         uuid not null references area_trabalho(id),
  vigencia_inicio date not null default hoje_local(),
  clientes        integer not null check (clientes > 0),
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references perfil(id),
  unique (area_id, vigencia_inicio)
);

comment on table base_clientes_area is
  '212: base de clientes de cada área de trabalho, com vigência — o denominador do AT1 do Dashboard VT.';

create index if not exists base_clientes_area_base_idx on base_clientes_area (base_id, area_id, vigencia_inicio desc);

alter table base_clientes_area enable row level security;

-- Empresa e cidade saem da ÁREA (da cidade dela: `area_trabalho.empresa_id` é
-- nulo nas áreas de hoje, medido em 05/11), e o autor sai do login: ninguém
-- manda isso do cliente (D-061). O WITH CHECK do RLS vê a linha DEPOIS deste
-- gatilho, então área de outra cidade é recusada pela policy.
create or replace function base_clientes_area_carimba()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select coalesce(t.empresa_id, b.empresa_id) as empresa_id, t.base_id into a
    from area_trabalho t left join base b on b.id = t.base_id
   where t.id = new.area_id;
  if a.base_id is null then
    raise exception 'Esta área não tem cidade cadastrada.' using errcode = '23514';
  end if;
  new.empresa_id := a.empresa_id;
  new.base_id := a.base_id;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
revoke all on function base_clientes_area_carimba() from public, anon;

drop trigger if exists base_clientes_area_carimba on base_clientes_area;
create trigger base_clientes_area_carimba
  before insert or update on base_clientes_area
  for each row execute function base_clientes_area_carimba();

drop policy if exists base_clientes_area_leitura on base_clientes_area;
create policy base_clientes_area_leitura on base_clientes_area for select to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis()));

drop policy if exists base_clientes_area_cadastra on base_clientes_area;
create policy base_clientes_area_cadastra on base_clientes_area for insert to authenticated
  with check (empresa_id = (select minha_empresa())
              and base_id in (select bases_visiveis())
              and (select pode_configurar('cadastrar')));

drop policy if exists base_clientes_area_edita on base_clientes_area;
create policy base_clientes_area_edita on base_clientes_area for update to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis())
         and (select pode_configurar('editar')))
  with check (empresa_id = (select minha_empresa())
              and base_id in (select bases_visiveis())
              and (select pode_configurar('editar')));

drop policy if exists base_clientes_area_exclui on base_clientes_area;
create policy base_clientes_area_exclui on base_clientes_area for delete to authenticated
  using (empresa_id = (select minha_empresa())
         and base_id in (select bases_visiveis())
         and (select pode_configurar('excluir')));

revoke all on base_clientes_area from anon;
grant select, insert, update, delete on base_clientes_area to authenticated;

-- ------------------------------------------------- gravar uma base (INVOKER) --
-- INVOKER de propósito: quem barra é o RLS acima. A função só dá o recado em
-- português antes de o banco dizer "violates row-level security".
create or replace function definir_base_clientes_area(
  p_area uuid, p_clientes integer, p_desde date default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_desde date := coalesce(p_desde, hoje_local());
  v_id uuid;
begin
  if not (select pode_configurar('cadastrar')) or not (select pode_configurar('editar')) then
    raise exception 'Só quem configura a operação cadastra a base de clientes.' using errcode = '42501';
  end if;
  if p_clientes is null or p_clientes <= 0 then
    raise exception 'A base de clientes é um número inteiro maior que zero.' using errcode = '22023';
  end if;
  if not exists (select 1 from area_trabalho a where a.id = p_area
                    and a.base_id in (select bases_visiveis())) then
    raise exception 'Esta área não é da cidade ativa.' using errcode = '42501';
  end if;

  insert into base_clientes_area (empresa_id, base_id, area_id, vigencia_inicio, clientes)
  values ((select minha_empresa()),
          (select base_id from area_trabalho where id = p_area),
          p_area, v_desde, p_clientes)
  on conflict (area_id, vigencia_inicio) do update set clientes = excluded.clientes
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'area_id', p_area, 'desde', v_desde, 'clientes', p_clientes);
end $$;
revoke all on function definir_base_clientes_area(uuid, integer, date) from public, anon;
grant execute on function definir_base_clientes_area(uuid, integer, date) to authenticated;

-- ------------------------------------------------------------- o dashboard --
create or replace function dashboard_visita_tecnica(p_dia date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_dia date := coalesce(p_dia, hoje_local());
  v_dias_mes int := extract(day from (date_trunc('month', coalesce(p_dia, hoje_local()))
                                      + interval '1 month - 1 day'))::int;
  v_terminais text[] := situacoes_terminais();
  v_out jsonb;
begin
  with vt as materialized (
    select v.id, v.contrato, v.situacao, v.equipe_id, v.area_id, v.tecnico_responsavel_id,
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
                                           v.dados_origem->>'Motivo de Fechamento Externo'))) as central_bruto
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
           (select count(*) from conta c where c.area_id = a.id)::int as vt
      from area_trabalho a
     where a.base_id in (select bases_visiveis())
       and (a.ativo or exists (select 1 from conta c where c.area_id = a.id))
  ),
  at1 as (
    select coalesce(sum(vt) filter (where clientes is not null), 0)::int as vt_com_base,
           sum(clientes)::bigint as base,
           (coalesce(sum(vt) filter (where clientes is null), 0)
            + (select count(*) from conta c where c.area_id is null
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
                  'total', count(*), 'rotulo', coalesce(e.codigo, '')) as x
                  from resultado r left join equipe e on e.id = r.equipe_id
                 group by r.equipe_id, e.codigo, e.nome) q), '[]'),
    'revisita', jsonb_build_object(
       'total', (select count(*) from rev),
       'tecnicos', coalesce((select jsonb_agg(jsonb_build_object(
            'tecnico', t, 'equipe', eq, 'n', n, 'itens', itens) order by n desc, t) from (
            select coalesce(anterior_tecnico, '') as t, max(anterior_equipe) as eq, count(*) as n,
                   jsonb_agg(jsonb_build_object('visita_id', visita_id, 'contrato', contrato,
                     'anterior_id', anterior_id, 'anterior_data', anterior_data,
                     'anterior_grupo', anterior_grupo, 'dias', dias,
                     'baixa', case when anterior_baixa_codigo is null then null
                                   else anterior_baixa_codigo || ' - ' || anterior_baixa_descricao end)
                     order by dias) as itens
              from rev group by coalesce(anterior_tecnico, '')) q), '[]')),
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
             group by k.codigo, k.descricao, k.natureza) q), '[]'))
  ) into v_out;

  return v_out;
end $$;
revoke all on function dashboard_visita_tecnica(date) from public, anon;
grant execute on function dashboard_visita_tecnica(date) to authenticated;

comment on function dashboard_visita_tecnica(date) is
  '212: o Dashboard Visita Técnica do dia (cidade ativa) — TEC1, LOG, AT5, AT1 e os ofensores. INVOKER: o RLS de visita é o escopo.';

notify pgrst, 'reload schema';
