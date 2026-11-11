-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 256 — Indicador REVISITA TÉCNICA (D-371)                             │
-- │                                                                      │
-- │ "criar um outro indicador no Menu indicadores Chamado - REVISITA     │
-- │  TÉCNICA (...) Revisita dividido pelo total que caiu na agenda       │
-- │  tirando cancelado central (...) filtro de supervisor, buckets, área │
-- │  (...) o volume executado pelo técnico no mês, e as revisitas que    │
-- │  voltarem em 30 dias são as que vão impactar a equipe (...) A        │
-- │  revisita para instalação é: Grupo de serviços instalação para       │
-- │  retorno, e retorno de retorno, e vt é vt da vt" — Emanuel, 11/11    │
-- │                                                                      │
-- │ Perguntado (11/11):                                                  │
-- │  · a anterior: "Instalação concluída; VT qualquer"                   │
-- │  · o total da cidade: só VT, Retorno e instalação                    │
-- │  · a base do técnico: os EXECUTADOS dele no período                  │
-- │                                                                      │
-- │ A REGRA (nenhuma busca nova — as funções que já existem):            │
-- │  VT  ← VT    `revisita_30d_vt` (D-363): a VT anterior em QUALQUER    │
-- │              situação, menos Auditar e cancelado pela central (elas  │
-- │              são puladas e vale a VT antes delas), até 30 dias.      │
-- │  RET ← INST  `revisita_dos_contratos` + `par_de_revisita` (D-245,    │
-- │              D-285): Retorno de credenciada cuja anterior CONCLUÍDA  │
-- │              é Adesão, Migração GPON, Reinstalação, Mudança de       │
-- │              endereço ou Retorno, até 30 dias.                       │
-- │  A visita NOVA não conta se for Auditar ou cancelada pela central.   │
-- │                                                                      │
-- │ DUAS RÉGUAS, cada uma com a sua data:                                │
-- │  CIDADE (os cards, as causas, a idade): pela data da REVISITA —      │
-- │    revisitas do período ÷ contratos VT/Retorno/instalação do período │
-- │    na conta (sem Auditar, sem cancelado pela central). VT ÷ VT;      │
-- │    instalação = Retorno revisita ÷ instalação + Retorno.             │
-- │  TÉCNICO e SUPERVISOR: pela data do SERVIÇO dele — executados no     │
-- │    período, e quantos voltaram em até 30 dias, contando até HOJE     │
-- │    (o número sobe enquanto a janela de 30 dias está aberta).         │
-- │    Executado: instalação/Retorno CONCLUÍDO; VT concluída, reagendada │
-- │    ou cancelada (sem Auditar e sem central) — como na              │
-- │    `revisita_do_tecnico` da manutenção (D-246). Só conta revisita    │
-- │    cuja anterior está nessa base: o numerador cabe no denominador.   │
-- │    O supervisor ofensor é a soma dos técnicos dele (na tela).        │
-- │  Os filtros valem para o contrato da régua: na cidade, a revisita;   │
-- │  no técnico, o serviço dele. O supervisor é o da D-134 (o declarado  │
-- │  no técnico → o da equipe → o texto da planilha).                    │
-- │                                                                      │
-- │ A CERTIDÃO ao lado do técnico é a régua da 235/244 (`classe_certidao`│
-- │ sobre o `sinal_claro`), sobre os contratos dele no período, na conta.│
-- │                                                                      │
-- │ INVOKER: o RLS de `visita` decide o que cada um vê (como o           │
-- │ `dashboard_visita_tecnica`).                                         │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.indicador_revisita_tecnica(
  p_de date default null, p_ate date default null,
  p_areas uuid[] default null, p_buckets text[] default null, p_supervisores text[] default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_hoje date := hoje_local();
  v_de   date := coalesce(p_de, date_trunc('month', hoje_local())::date);
  v_ate  date := greatest(coalesce(p_ate, hoje_local()), coalesce(p_de, date_trunc('month', hoje_local())::date));
  -- até onde se procura a revisita de um serviço do período: 30 dias depois, nunca além de hoje
  v_fim  date;
  v_out  jsonb;
begin
  if v_ate - v_de > 92 then
    raise exception 'Escolha um periodo de ate 3 meses.' using errcode = '22023';
  end if;
  v_fim := greatest(v_ate, least(v_ate + 30, v_hoje));

  -- O histórico do ngestor (set/out) não traz o técnico, só a equipe: vale o técnico
  -- ATIVO cadastrado na equipe quando ela tem um só — "a equipe é a pessoa" (220, D-328).
  -- A resposta diz quando o nome veio do cadastro.
  with equipe_tec as materialized (
    select t.equipe_id, (array_agg(t.id))[1] as tec
      from tecnico t where t.situacao = 'ATIVO' and t.equipe_id is not null
     group by t.equipe_id having count(*) = 1
  ),
  todos as materialized (
    select v.id, v.contrato, v.situacao, v.data_agendada as dia, v.criado_em,
           g.nome as grupo,
           case when g.nome = 'VISITA TECNICA' then 'VT' else 'INST' end as familia,
           v.area_id, v.equipe_id, coalesce(v.tecnico_responsavel_id, et.tec) as tec,
           (v.tecnico_responsavel_id is null and et.tec is not null) as tec_do_cadastro,
           coalesce(nullif(btrim(v.toa_bucket), ''), 'SEM_BUCKET') as bucket,
           coalesce(ps.nome, pe.nome, nullif(btrim(e.supervisor_nome), ''), 'SEM_SUPERVISOR') as supervisor,
           -- Auditar = o 800 do sistema; central = o TOA cancelou pela central (como no painel de VT)
           (v.situacao = 'CANCELADA' and exists (
              select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
               where o.visita_id = v.id and cb.codigo = 800)) as auditar,
           (v.situacao = 'CANCELADA'
            and (v.cancelado_central_em is not null
                 or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                           v.dados_origem->>'Motivo de Fechamento Externo'))) as central
      from visita v
      join tipo_servico g on g.id = v.tipo_servico_id
       and g.nome in ('VISITA TECNICA', 'RETORNO DE CREDENCIADA', 'ADESAO', 'MIGRACAO GPON',
                      'REINSTALACAO', 'MUDANCA DE ENDERECO')
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join equipe e   on e.id = v.equipe_id
      left join perfil pe  on pe.id = e.supervisor_id
      left join equipe_tec et on et.equipe_id = v.equipe_id
      left join tecnico tc on tc.id = coalesce(v.tecnico_responsavel_id, et.tec)
      left join perfil ps  on ps.id = tc.supervisor_id
     where v.data_agendada between v_de and v_fim
       and v.excluido_em is null
       and v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and coalesce(ta.natureza, '') <> 'JORNADA'
  ),
  conta_todos as materialized (
    select * from todos where not auditar and not central
  ),
  -- as revisitas de [início, fim]: a régua da VT e a da instalação, cada uma pela sua função
  rev as materialized (
    select r.visita_id, r.anterior_id, r.anterior_data, r.anterior_situacao,
           r.anterior_baixa_codigo as codigo, r.anterior_baixa_descricao as descricao, r.dias,
           'VT'::text as familia
      from revisita_30d_vt((select coalesce(array_agg(id), '{}') from conta_todos
                             where familia = 'VT' and contrato is not null)) r
     where r.anterior_id is not null
    union all
    select r.visita_id, r.anterior_id, r.anterior_data, r.anterior_situacao,
           r.anterior_baixa_codigo, r.anterior_baixa_descricao, r.dias, 'INST'
      from revisita_dos_contratos((select coalesce(array_agg(id), '{}') from conta_todos
                                    where grupo = 'RETORNO DE CREDENCIADA' and contrato is not null)) r
     where r.revisita
  ),
  -- a régua da CIDADE: a visita do período, nos filtros
  conta as materialized (
    select * from conta_todos
     where dia between v_de and v_ate
       and (coalesce(cardinality(p_areas), 0) = 0 or area_id = any(p_areas))
       and (coalesce(cardinality(p_buckets), 0) = 0 or bucket = any(p_buckets))
       and (coalesce(cardinality(p_supervisores), 0) = 0 or supervisor = any(p_supervisores))
  ),
  rev_cidade as materialized (
    select r.*, c.contrato, c.dia, c.situacao, c.grupo, c.equipe_id, c.tec
      from rev r join conta c on c.id = r.visita_id
  ),
  -- a régua do TÉCNICO: os executados dele no período, nos filtros (do serviço)
  exec as materialized (
    select t.* from todos t
     where t.dia between v_de and v_ate and t.tec is not null
       and not t.auditar and not t.central
       and (coalesce(cardinality(p_areas), 0) = 0 or t.area_id = any(p_areas))
       and (coalesce(cardinality(p_buckets), 0) = 0 or t.bucket = any(p_buckets))
       and (coalesce(cardinality(p_supervisores), 0) = 0 or t.supervisor = any(p_supervisores))
       and case when t.familia = 'VT' then t.situacao in ('CONCLUIDA', 'REAGENDAMENTO', 'CANCELADA')
                else t.situacao = 'CONCLUIDA' end
  ),
  -- a revisita de cada executado (a primeira, se voltou mais de uma vez)
  rev_tec as materialized (
    select distinct on (x.id) x.id as servico_id, x.tec, x.familia, x.supervisor, x.equipe_id,
           x.dia as servico_dia, x.contrato,
           r.visita_id, n.dia as rev_dia, r.dias, r.codigo, r.descricao
      from exec x
      join rev r on r.anterior_id = x.id and r.familia = x.familia
      join todos n on n.id = r.visita_id
     order by x.id, n.dia, n.criado_em
  ),
  cert as materialized (
    select c.tec, classe_certidao(s.status_os_texto, s.validacao_cor) as cl
      from conta c join sinal_claro s on s.visita_id = c.id
     where c.tec is not null
  ),
  por_tec as (
    select x.tec,
           count(*) filter (where x.familia = 'VT')::int as exec_vt,
           count(*) filter (where x.familia = 'INST')::int as exec_inst,
           count(*) filter (where x.dia > v_hoje - 30)::int as janela_aberta,
           mode() within group (order by x.supervisor) as supervisor,
           mode() within group (order by x.equipe_id) as equipe_id,
           bool_or(x.tec_do_cadastro) as do_cadastro
      from exec x group by x.tec
  )
  select jsonb_build_object(
    'de', v_de, 'ate', v_ate, 'revisita_ate', v_fim, 'hoje', v_hoje,

    -- as opções dos filtros: o que tem contrato no período (e o que já está marcado)
    'areas_opcoes', coalesce((select jsonb_agg(jsonb_build_object('area_id', a.id,
                        'rotulo', coalesce(nullif(a.apelido, ''), a.codigo)) order by coalesce(nullif(a.apelido, ''), a.codigo))
                      from area_trabalho a
                     where a.id in (select area_id from todos where dia between v_de and v_ate)
                        or a.id = any(coalesce(p_areas, '{}'))), '[]'),
    'buckets_opcoes', coalesce((select jsonb_agg(jsonb_build_object('bucket', b, 'n', n) order by b)
                       from (select bucket as b, count(*)::int as n from todos
                              where dia between v_de and v_ate group by 1) q), '[]'),
    'supervisores_opcoes', coalesce((select jsonb_agg(jsonb_build_object('supervisor', s, 'n', n)
                                     order by s = 'SEM_SUPERVISOR', s)
                       from (select supervisor as s, count(*)::int as n from todos
                              where dia between v_de and v_ate group by 1) q), '[]'),

    -- os cards: a régua da cidade
    'cidade', jsonb_build_object(
       'conta', (select count(*) from conta),
       'revisitas', (select count(*) from rev_cidade),
       'vt_conta', (select count(*) from conta where familia = 'VT'),
       'vt_rev', (select count(*) from rev_cidade where familia = 'VT'),
       'inst_conta', (select count(*) from conta where familia = 'INST'),
       'inst_rev', (select count(*) from rev_cidade where familia = 'INST'),
       'fora', jsonb_build_object(
          'auditar', (select count(*) from todos where dia between v_de and v_ate and auditar),
          'central', (select count(*) from todos where dia between v_de and v_ate and central and not auditar))),

    -- cada revisita do período (as causas, a idade, o dia, a lista)
    'lista', coalesce((select jsonb_agg(jsonb_build_object(
          'visita_id', r.visita_id, 'contrato', r.contrato, 'dia', r.dia, 'familia', r.familia,
          'grupo', r.grupo, 'situacao', r.situacao, 'equipe', eq.codigo, 'tecnico', tn.nome,
          'anterior_id', r.anterior_id, 'anterior_data', r.anterior_data,
          'anterior_grupo', ga.nome, 'anterior_situacao', r.anterior_situacao,
          'anterior_tecnico_id', ta.id, 'anterior_tecnico', ta.nome,
          'anterior_tecnico_do_cadastro', a.tecnico_responsavel_id is null and ta.id is not null,
          'anterior_equipe', ea.codigo,
          'anterior_supervisor', coalesce(psa.nome, pea.nome, nullif(btrim(ea.supervisor_nome), ''), 'SEM_SUPERVISOR'),
          'anterior_baixa', case when r.codigo is null then null else r.codigo || ' - ' || r.descricao end,
          'dias', r.dias,
          'anterior_sinal', case when s.visita_id is null then null else jsonb_build_object(
                               'validacao', s.validacao_texto, 'cor', s.validacao_cor,
                               'status_os', s.status_os_texto, 'inicial', s.inicial_texto,
                               'classe', classe_certidao(s.status_os_texto, s.validacao_cor)) end)
          order by r.dia desc, r.contrato)
        from rev_cidade r
        join visita a on a.id = r.anterior_id
        left join tipo_servico ga on ga.id = a.tipo_servico_id
        left join equipe eq on eq.id = r.equipe_id
        left join tecnico tn on tn.id = r.tec
        left join equipe_tec eta on eta.equipe_id = a.equipe_id
        left join tecnico ta on ta.id = coalesce(a.tecnico_responsavel_id, eta.tec)
        left join equipe ea on ea.id = a.equipe_id
        left join perfil pea on pea.id = ea.supervisor_id
        left join perfil psa on psa.id = ta.supervisor_id
        left join sinal_claro s on s.visita_id = r.anterior_id), '[]'),

    -- a régua do técnico: executados, revisitas e a certidão
    'tecnicos', coalesce((select jsonb_agg(jsonb_build_object(
          'tecnico_id', p.tec, 'tecnico', t.nome, 'equipe', e.codigo, 'supervisor', p.supervisor,
          'exec_vt', p.exec_vt, 'exec_inst', p.exec_inst, 'janela_aberta', p.janela_aberta,
          'nome_do_cadastro', p.do_cadastro,
          'rev_vt', (select count(*) from rev_tec k where k.tec = p.tec and k.familia = 'VT'),
          'rev_inst', (select count(*) from rev_tec k where k.tec = p.tec and k.familia = 'INST'),
          'cert_fin', (select count(*) from cert k where k.tec = p.tec and k.cl is not null),
          'cert_validado', (select count(*) from cert k where k.tec = p.tec and k.cl in ('REGULAR', 'COM_FALHA')))
          order by t.nome)
        from por_tec p
        left join tecnico t on t.id = p.tec
        left join equipe e on e.id = p.equipe_id), '[]'),

    -- cada serviço do técnico que voltou (o código, o dia da revisita)
    'rev_tecnico', coalesce((select jsonb_agg(jsonb_build_object(
          'tecnico_id', k.tec, 'familia', k.familia, 'servico_id', k.servico_id,
          'servico_dia', k.servico_dia, 'contrato', k.contrato,
          'visita_id', k.visita_id, 'rev_dia', k.rev_dia, 'dias', k.dias,
          'baixa', case when k.codigo is null then null else k.codigo || ' - ' || k.descricao end)
          order by k.rev_dia desc)
        from rev_tec k), '[]')
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.indicador_revisita_tecnica(date, date, uuid[], text[], text[]) from public, anon;
grant execute on function public.indicador_revisita_tecnica(date, date, uuid[], text[], text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
