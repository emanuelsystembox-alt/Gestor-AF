-- 262 · Node em degradação — VT acumulando no mesmo node com cara de falha de REDE (D-376)
--
-- RESPOSTAS DO EMANUEL (12/11), sobre a medida abaixo:
--   · volume sozinho NÃO alerta: exige indício de rede (as regras R1/R2 abaixo);
--   · o 573 (Data Center / Headend Com Problema, sem agrupamento) conta como INFRA CLARO
--     NESTE alerta — o agrupamento global da quebra (D-254) não muda; "queimado" (522, 517,
--     510) fica fora por ora;
--   · GPONA01..05 de São Luís são agrupador do GPON, não node: saem do alerta (e da régua);
--   · a tela é da gestão; o aviso no sino vai só para quem vê a cidade inteira, gravado pelo
--     relógio de hora em hora (`registrar_nodes_em_degradacao`) — não pesa na abertura do sino.
--
-- > Ideia aprovada pelo Emanuel (pacote preditivo, 12/11): quando várias visitas técnicas
-- > se acumulam no MESMO node num intervalo curto, com o sinal "antes" irregular, é provável
-- > falha de rede da CLARO, não do técnico. Avisar a gestão para não mandar vários técnicos
-- > para o mesmo problema, ter prova para contestar indicador (AT1, revisita) e não punir o
-- > técnico pela rede.
--
-- O QUE NÃO FAZ (D-262)
--   É SUGESTÃO para a gestão, no site. Nada muda sozinho, nada vai para o app do técnico,
--   nenhuma mensagem a cliente. A função só lê.
--
-- O QUE O HISTÓRICO MOSTROU (fev a 11/11/2026, Manaus e São Luís, ~45 mil VT na conta)
--   · VOLUME SOZINHO NÃO É REDE. Node com pico de VT (Poisson, abaixo) e nenhum outro indício:
--     nos 3 dias seguintes o node teve 4,3% de baixa INFRA CLARO em Manaus (a cidade: 3,7%) e
--     9,9% em São Luís (9,0%) — o mesmo que qualquer node. O que o pico tem a mais é "queimado"
--     (522, 517, 510: 1,3× a 2×), que pode ser surto de energia, não rede da CLARO.
--   · O que separa a rede é a BAIXA DE INFRA DE OUTROS CONTRATOS DO MESMO NODE. Uma VT
--     baixada como INFRA CLARO tem outra INFRA CLARO no mesmo node em ±2 dias 3,6× (Manaus) e
--     2,7× (São Luís) mais que uma VT qualquer: a rede quebra para vários de uma vez.
--   · Sinal inicial irregular sozinho não separa nada: é o normal da VT (58–69% dos lidos em
--     Manaus, 43–54% em São Luís, dentro e fora de pico — 06 a 11/11). Entra só como indício
--     junto do pico, e é a parte NÃO VALIDADA da regra (o sinal só existe desde 06/11).
--   · A RUA (logradouro|bairro do Dashboard VT) é fraca como unidade: 34% a 47% das ruas com 2
--     VT em 48 h atravessam mais de um node (avenida longa). Fica como detalhe dentro do node.
--
-- A REGRA (cada número tem a medida ao lado; nenhum peso escrito à mão)
--   O dia D é o DIA DE ATUAÇÃO (`data_agendada`); "48 h" = D-1 e D; "72 h" = D-2 a D.
--   Universo = a "conta" do Dashboard VT (212 em diante): grupo VISITA TECNICA, sem jornada,
--   sem excluído, sem Auditar (800 na baixa da AFLINE) e sem cancelado pela central.
--   Contagem por CONTRATO distinto (o mesmo cliente voltando não é outro cliente afetado).
--   Só avalia node que tem VT no dia D (sem VT hoje, não há o que decidir hoje).
--   INFRA CLARO = `agrupamento_da_quebra(...)` da VT (203, 204, 205, 206, 211, 308), no código
--   do contrato como o Dashboard VT lê: as O.S. com baixa do TOA; sem nenhuma, as da AFLINE.
--
--   R1 · A REDE JÁ SE MOSTROU: 2 ou mais contratos do node baixados INFRA CLARO em 72 h, e
--        isso é improvável por acaso — Poisson P(X ≥ infra | μ = contratos do node em 72 h ×
--        taxa INFRA CLARO da cidade nos 30 dias antes) < 0,01. O "por acaso" pesa: em São Luís
--        os nodes GPONA0x têm ~4 a 6 VT por dia, e "2 de infra" ali sem o teste dava 15,8% de
--        infra nos dias seguintes (a cidade: 8,6%); com o teste, 29,3%.
--   R2 · PICO COM INDÍCIO: 3 ou mais contratos do node em 48 h, P(X ≥ k | λ) < 0,01, com
--        λ = 2 × a média diária de VT do node nos 30 dias antes da janela (D-31 a D-2),
--        suavizada com 10 dias "fantasmas" na média da cidade por node — node novo ou calado
--        não vira alerta com 2 VT —; E ao menos um indício de rede: 1 contrato INFRA CLARO em
--        72 h, ou 2 contratos com Diagnóstico Inicial "Nível Irregular" em 48 h.
--   Mínimos (2 de infra, 3 contratos) e o corte de 0,01 saíram da conta de alertas por dia
--   abaixo; com 0,05 os candidatos a pico ficavam ~2,7 vezes mais, com acerto menor (São
--   Luís: 8,9% de infra contra 11,4% na faixa abaixo de 0,01).
--
-- O ACERTO NO HISTÓRICO — ESTA função, chamada como authenticated para cada dia de 15/02 a
-- 11/11 (270 dias por cidade), numa transação desfeita. Acerto = baixa INFRA CLARO nas VT do
-- node nos 3 dias SEGUINTES ao alerta, que a regra não viu:
--                 alertas/dia (média · máx)   dias sem alerta   infra depois   a cidade
--   Manaus        0,46 · 4                    184 de 270        15,8%          3,4%
--   São Luís      1,03 · 9 (09/05)            104 de 270        17,3%          7,4%
--   Por regra (Manaus · São Luís): INFRA 32,7% · 16,7%; INFRA+PICO 23,3% · 43,2%;
--   só PICO 7,3% · 15,5%. Episódios (dias seguidos do mesmo node): 0,34/dia e 0,72/dia.
--   Revisita na janela dos alertas (prova para contestar): 18,4% contra 15,9% da cidade em
--   Manaus, 23,0% contra 19,6% em São Luís (medido na versão de análise da regra).
--   Tempo como authenticated: 226 ms (Manaus) e 246 ms (São Luís) em média, 475 ms no pior.
--
-- POR QUE DEFINER
--   A base do node é um fato da CIDADE: um controlador que vê três equipes não pode ter a
--   régua calculada só sobre elas. A conta corre sobre a cidade ativa inteira (uma só, como
--   o risco de quebra, 181) depois de conferir `eh_gestao()`; a LISTA de contratos sai só
--   com o que a pessoa já enxerga (`ve_cidade_inteira()` ou `equipes_visiveis()`), e o resto
--   vira um número ("de outras equipes"). Nenhum nome, telefone ou número de casa: a rua vai
--   sem o número, como chave de agrupamento.
--
-- NÃO VERIFICADO
--   · o indício "2 com sinal inicial irregular" (5 dias de dado: não há como medir o acerto);
--   · o efeito do dia da semana (domingo tem metade das VT; a base mistura os dias);


create or replace function public.nodes_em_degradacao(p_dia date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dia      date := coalesce(p_dia, hoje_local());
  v_emp      uuid := minha_empresa();
  v_base     uuid;
  -- o alcance de quem lê e a lista de terminais, resolvidos UMA vez (traps: função solta
  -- no WHERE é chamada por linha, inclusive dentro de função — D-248)
  v_inteira  boolean := ve_cidade_inteira();
  v_eqs      uuid[] := '{}';
  v_term     text[] := situacoes_terminais();
  -- a régua (ver o cabeçalho; mudar aqui é mudar a regra medida)
  c_corte    constant float8 := 0.01;   -- Poisson unilateral, R1 e R2
  c_min_inf  constant int := 2;         -- R1: contratos INFRA CLARO em 72 h
  c_min_vol  constant int := 3;         -- R2: contratos em 48 h
  c_min_irr  constant int := 2;         -- R2: indício pelo sinal inicial (NÃO validado)
  c_fant     constant numeric := 10;    -- dias "fantasmas" da suavização da base do node
  v_out      jsonb;
begin
  if not eh_gestao() then
    raise exception 'O node em degradação é da gestão.' using errcode = '42501';
  end if;
  select case when count(*) = 1 then min(b::text)::uuid end into v_base from bases_visiveis() b;
  if v_base is null then
    raise exception 'Escolha uma cidade no topo.' using errcode = '22023';
  end if;
  if not v_inteira then
    v_eqs := array(select equipes_visiveis());
  end if;

  with
  -- O universo: a "conta" do Dashboard VT, na cidade ativa inteira, de D-31 a D.
  vt as materialized (
    select v.id, v.contrato, coalesce(v.contrato, v.id::text) as chave,
           v.data_agendada as dia, v.situacao, v.equipe_id, v.area_id,
           -- D-376: GPONA01..05 (São Luís) é agrupador do GPON, não node — fica de fora
           (select case when x.n ~* '^GPONA[0-9]*$' then null else x.n end
              from (select coalesce(nullif(btrim(v.node), ''), nullif(btrim(v.dados_origem->>'Node'), '')) as n) x) as node,
           -- a chave da rua do Dashboard VT (217); o texto vai sem o número da casa
           case when nullif(btrim(v.logradouro), '') is null then null
                else norm_txt(split_part(v.logradouro, ',', 1)) || '|' || norm_txt(v.bairro) end as rua,
           nullif(concat_ws(' · ', nullif(btrim(split_part(v.logradouro, ',', 1)), ''),
                                   nullif(btrim(v.bairro), '')), '') as rua_txt
      from visita v
      join tipo_servico g on g.id = v.tipo_servico_id and g.nome = 'VISITA TECNICA'
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = v_emp
       and v.base_id = v_base
       and v.excluido_em is null
       and v.data_agendada between v_dia - 31 and v_dia
       and coalesce(ta.natureza, '') <> 'JORNADA'
       -- Auditar = o 800 na baixa da AFLINE (como o Dashboard VT e origemCancelada())
       and not (v.situacao = 'CANCELADA' and exists (
                  select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                   where o.visita_id = v.id and cb.codigo = 800))
       -- cancelado pela central (a `central_bruto` do Dashboard VT)
       and not (v.situacao = 'CANCELADA'
                and (v.cancelado_central_em is not null
                     or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                               v.dados_origem->>'Motivo de Fechamento Externo')))
  ),
  -- O código do contrato: as O.S. com baixa do TOA; sem nenhuma, as da AFLINE (Dashboard VT).
  codos as materialized (
    select vt.id,
           case when exists (select 1 from ordem_servico x where x.visita_id = vt.id and x.codigo_baixa_id is not null)
                then o.codigo_baixa_id else o.codigo_baixa_afline_id end as cb_id
      from vt join ordem_servico o on o.visita_id = vt.id
  ),
  cod as materialized (
    select k.id,
           bool_or(agrupamento_da_quebra(cb.agrupamento_quebra, cb.agrupamento_quebra_vt, 'VISITA TECNICA')
                   = 'INFRA CLARO'
                   -- D-376: o 573 (Data Center / Headend) é rede da CLARO, só neste alerta
                   or cb.codigo = 573) as infra,
           string_agg(distinct cb.codigo || ' - ' || cb.descricao, ' · ') as codigos
      from codos k join codigo_baixa cb on cb.id = k.cb_id
     group by k.id
  ),
  u as materialized (
    select vt.*, coalesce(c.infra, false) as infra, c.id is not null as tem_cod, c.codigos
      from vt left join cod c on c.id = vt.id
  ),
  -- A régua da cidade, nos 30 dias antes da janela (D-31 a D-2) — a janela não entra.
  regua as materialized (
    select (select count(*)::numeric / nullif(count(distinct node) * 30, 0)
              from u where node is not null and dia <= v_dia - 2) as prior,
           (select count(distinct chave) filter (where infra)::numeric
                     / nullif(count(distinct chave) filter (where tem_cod), 0)
              from u where dia <= v_dia - 2) as tx_inf
  ),
  nodes as materialized (
    select u.node,
           count(distinct u.chave) filter (where u.dia >= v_dia - 1) as c2,
           count(distinct u.chave) filter (where u.dia >= v_dia - 2) as c3,
           count(distinct u.chave) filter (where u.dia >= v_dia - 2 and u.infra) as inf3,
           count(*) filter (where u.dia <= v_dia - 2) as n30,
           count(*) filter (where u.dia = v_dia and not (u.situacao = any (v_term))) as abertos_hoje
      from u
     where u.node is not null
     group by u.node
    -- só o node que tem VT no dia: sem VT hoje, não há o que decidir hoje
    having count(*) filter (where u.dia = v_dia) > 0
  ),
  sin as materialized (
    select u.node,
           count(distinct u.chave) filter (where norm_txt(s.inicial_texto) = 'NIVEL IRREGULAR') as irr2,
           count(distinct u.chave) filter (where norm_txt(s.inicial_texto) in ('NIVEL IRREGULAR', 'NIVEL REGULAR')) as lidos2
      from u join sinal_claro s on s.visita_id = u.id
     where u.node is not null and u.dia >= v_dia - 1
     group by u.node
  ),
  teste as materialized (
    select n.*, coalesce(si.irr2, 0) as irr2, coalesce(si.lidos2, 0) as lidos2, l.lam2, l.mu,
           -- Poisson unilateral: P(X >= k) = 1 - soma_{i<k} e^-λ λ^i / i!
           (select 1 - coalesce(sum(exp(-l.lam2) * power(l.lam2, i) / factorial(i)::float8), 0)
              from generate_series(0, n.c2 - 1) i) as p_vol,
           -- sem taxa de infra na cidade (nenhum código em 30 dias), R1 não se avalia: nulo
           case when l.mu is not null then
             (select 1 - coalesce(sum(exp(-l.mu) * power(l.mu, i) / factorial(i)::float8), 0)
                from generate_series(0, n.inf3 - 1) i) end as p_inf
      from nodes n
      cross join regua rg
      left join sin si on si.node = n.node
      cross join lateral (
        select (2 * (n.n30 + c_fant * coalesce(rg.prior, 0)) / (30 + c_fant))::float8 as lam2,
               (n.c3 * rg.tx_inf)::float8 as mu) l
  ),
  em as materialized (
    select t.*,
           coalesce(t.inf3 >= c_min_inf and t.p_inf < c_corte, false) as r1,
           (t.c2 >= c_min_vol and t.p_vol < c_corte and (t.inf3 >= 1 or t.irr2 >= c_min_irr)) as r2
      from teste t
  )
  select jsonb_build_object(
      'dia', v_dia,
      'cidade', (select b.nome from base b where b.id = v_base),
      'regua', (select jsonb_build_object(
          'de', v_dia - 31, 'ate', v_dia - 2,
          'vt_por_node_dia', round(rg.prior, 3),
          'taxa_infra', round(rg.tx_inf * 100, 1),
          'nodes_avaliados', (select count(*) from nodes),
          'corte', c_corte, 'min_infra', c_min_inf, 'min_vt', c_min_vol, 'min_irregular', c_min_irr)
          from regua rg),
      'alertas', coalesce((select jsonb_agg(jsonb_build_object(
          'node', a.node,
          'area', (select coalesce(nullif(ar.apelido, ''), ar.codigo)
                     from u join area_trabalho ar on ar.id = u.area_id
                    where u.node = a.node and u.dia >= v_dia - 2
                    group by ar.apelido, ar.codigo order by count(*) desc limit 1),
          'vt_48h', a.c2, 'vt_72h', a.c3,
          'base_48h', round(a.lam2::numeric, 2),
          'vezes', case when a.lam2 > 0 then round((a.c2 / a.lam2)::numeric, 1) end,
          'p_volume', round(a.p_vol::numeric, 5),
          'infra_72h', a.inf3,
          'infra_esperado', round(a.mu::numeric, 2),
          'p_infra', round(a.p_inf::numeric, 5),
          'irregular_48h', a.irr2, 'lidos_48h', a.lidos2,
          'abertos_hoje', a.abertos_hoje,
          'regras', to_jsonb(array_remove(array[case when a.r1 then 'INFRA' end,
                                                case when a.r2 then 'PICO' end], null)),
          'porque', concat_ws(' · ',
              case when a.inf3 > 0 then a.inf3 || ' com baixa INFRA CLARO em 72 h (esperado '
                   || replace(round(a.mu::numeric, 1)::text, '.', ',') || ')' end,
              a.c2 || ' VT em 48 h (normal ' || replace(round(a.lam2::numeric, 1)::text, '.', ',') || ')',
              case when a.irr2 > 0 then a.irr2 || ' de ' || a.lidos2 || ' lidos com sinal inicial irregular' end),
          'ruas', (select coalesce(jsonb_agg(jsonb_build_object('rua', r.rua_txt, 'n', r.n)
                                             order by r.n desc, r.rua_txt), '[]')
                     from (select min(u.rua_txt) as rua_txt, count(distinct u.chave) as n
                             from u
                            where u.node = a.node and u.dia >= v_dia - 2 and u.rua is not null
                            group by u.rua
                           having count(distinct u.chave) >= 2) r),
          'contratos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'visita_id', u.id, 'contrato', u.contrato, 'dia', u.dia,
                  'situacao', u.situacao, 'situacao_label', sv.label,
                  'equipe', e.codigo, 'codigos', u.codigos, 'infra', u.infra,
                  'sinal_inicial', s.inicial_texto)
                order by u.dia desc, u.infra desc, u.contrato), '[]')
                  from u
                  left join situacao_visita sv on sv.codigo = u.situacao
                  left join equipe e on e.id = u.equipe_id
                  left join sinal_claro s on s.visita_id = u.id
                 where u.node = a.node and u.dia >= v_dia - 2
                   and (v_inteira or u.equipe_id = any (v_eqs))),
          'fora_do_alcance', (select count(*) from u
                               where u.node = a.node and u.dia >= v_dia - 2
                                 and not (v_inteira or coalesce(u.equipe_id = any (v_eqs), false)))
        ) order by a.r1 desc, least(coalesce(a.p_inf, 1), a.p_vol), a.node)
        from em a where a.r1 or a.r2), '[]'::jsonb)
    ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.nodes_em_degradacao(date) from public, anon;
grant execute on function public.nodes_em_degradacao(date) to authenticated;

-- ─────────────────────────────────────────────────────────────── o sino ──
alter table public.sinal drop constraint if exists sinal_tipo_check;
alter table public.sinal add constraint sinal_tipo_check check (tipo = any (array[
  'AJUDA','TEC1','RITMO','QUEBROU','MATERIAL','ABASTECIMENTO','CERCA','GPS','DOIS_ATIVOS','SUMIU_TOA',
  'LOCAL','ATRASO','TEC1_RISCO','RESUMO','SEM_IMPORTACAO','SEM_COMPUTADOR','TOA_SESSAO','EXECUCAO_LONGA',
  'NODE_DEGRADACAO']));

-- Grava o aviso pelo relógio (a conta custa ~250 ms: no sino, pesaria em toda abertura — D-248).
create or replace function public.registrar_nodes_em_degradacao()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base uuid;
  r jsonb;
begin
  if current_setting('app.pelo_relogio', true) is distinct from '1' then
    raise exception 'O node em degradação é gravado pelo relógio.' using errcode = '42501';
  end if;
  select b into v_base from bases_visiveis() b limit 1;
  if v_base is null then return; end if;

  r := nodes_em_degradacao();
  insert into sinal (empresa_id, base_id, chave, dia, tipo, titulo, detalhe)
  select minha_empresa(), v_base,
         'NODE:' || v_base || ':' || (a ->> 'node') || ':' || (r ->> 'dia'),
         (r ->> 'dia')::date, 'NODE_DEGRADACAO',
         'Node em degradação: ' || (a ->> 'node') || coalesce(' · ' || (a ->> 'area'), ''),
         a ->> 'porque'
    from jsonb_array_elements(r -> 'alertas') a
  on conflict (empresa_id, chave) do nothing;
end $$;
revoke all on function public.registrar_nodes_em_degradacao() from public, anon, authenticated;

-- A leitura do sino (a versão VIVA de `sinais_do_dia`, com duas linhas a mais: o tipo novo
-- é vigente o dia todo e só quem vê a cidade inteira o enxerga).
CREATE OR REPLACE FUNCTION public.sinais_do_dia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_c jsonb := central_do_controle();
  v_hoje date := hoje_local();
  v_ini timestamptz := (hoje_local()::timestamp at time zone 'America/Manaus');
  v_emp uuid := minha_empresa();
  v_gestao boolean := eh_gestao();
  v_vigentes text[] := '{}';
  v_fora uuid[] := '{}';
  v_antec int := coalesce((select (valor #>> '{}')::int from parametro
                            where empresa_id = minha_empresa()
                              and chave = 'atraso_antecedencia_min'), 30);
  v_sinais jsonb;
  v_risco text[];
  v_sinc text[];
  v_longa text[];
begin
  if v_gestao then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde'), v_hoje, 'AJUDA',
           'Suporte técnico: ' || coalesce(x->>'tecnico', 'técnico'),
           concat_ws(' · ', x->>'servico',
                     case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
                     x->>'observacao'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x
      join visita v on v.id = (x->>'visita_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'AJUDA:' || (x->>'visita_id') || ':' || (x->>'desde')
                                        from jsonb_array_elements(coalesce(v_c->'ajuda', '[]')) x);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'TEC1:' || v.id, v_hoje, 'TEC1', 'TEC1 perdido: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO'
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'TEC1:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.tec1 = 'SEM_PADRAO');

    select coalesce(array_agg(l.visita_id), '{}') into v_fora
      from local_da_baixa(array(
             select v.id from visita v
               left join tipo_atividade ta on ta.id = v.tipo_atividade_id
              where v.empresa_id = v_emp and v.excluido_em is null
                and v.data_agendada = v_hoje
                and v.situacao = any (situacoes_terminais())
                and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
                and v.base_id in (select bases_visiveis())
                and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis())))) l
     where l.fora_do_raio;

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'LOCAL:' || v.id, v_hoje, 'LOCAL',
           'Baixa longe do cliente: ' || coalesce(t.nome, 'sem tecnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     case when e.codigo is not null then 'equipe ' || e.codigo end,
                     'fora do raio'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
     where v.id = any (v_fora)
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'LOCAL:' || x from unnest(v_fora) x);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'ATRASO:' || v.id, v_hoje, 'ATRASO',
           'Janela acabando sem chegada: ' || coalesce(t.nome, coalesce(e.codigo, 'sem tecnico')),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     'janela ate ' || to_char(v.janela_fim, 'HH24:MI'),
                     coalesce(sv.label, v.situacao)),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe e on e.id = v.equipe_id
      left join situacao_visita sv on sv.codigo = v.situacao
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.data_agendada = v_hoje
       and v.janela_fim is not null
       and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'COM_IMPEDIMENTO')
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
       and ((v.data_agendada + v.janela_fim) at time zone 'America/Manaus')
             <= now() + make_interval(mins => v_antec)
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'ATRASO:' || v.id from visita v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.data_agendada = v_hoje and v.janela_fim is not null
         and v.situacao in ('ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'COM_IMPEDIMENTO')
         and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
         and ((v.data_agendada + v.janela_fim) at time zone 'America/Manaus')
               <= now() + make_interval(mins => v_antec));

    -- 176: TEC1 em risco pela fila do técnico -- só ANTES do ATRASO começar
    -- (depois, o ATRASO já fala do mesmo contrato). O nível vai na chave: o
    -- risco que vira "vai estourar" avisa de novo.
    with rk as materialized (
      select x from jsonb_array_elements(tec1_em_risco()) x
       where x->>'nivel' in ('EM_RISCO', 'VAI_ESTOURAR')
         and (x->>'prazo_chegada')::timestamptz > now() + make_interval(mins => v_antec)
    ), ins as (
      insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
      select v_emp, 'TEC1R:' || (x->>'visita_id') || ':' || (x->>'nivel'), v_hoje, 'TEC1_RISCO',
             case x->>'nivel' when 'VAI_ESTOURAR' then 'TEC1 vai estourar: ' else 'TEC1 em risco: ' end
               || coalesce(x->>'tecnico', 'equipe ' || (x->>'equipe'), 'sem técnico'),
             concat_ws(' · ',
               case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
               'janela ' || (x->>'janela'),
               case when (x->>'comecou')::boolean
                    then 'termina ~' || to_char((x->>'previsto_fim')::timestamptz at time zone 'America/Manaus', 'HH24:MI')
                    else 'chega ~' || to_char((x->>'previsto_chegada')::timestamptz at time zone 'America/Manaus', 'HH24:MI') end,
               case when (x->>'na_frente')::int > 0 then (x->>'na_frente') || ' na frente' end,
               case when x->>'distancia_km' is not null then 'a ' || replace(x->>'distancia_km', '.', ',') || ' km' end),
             (x->>'visita_id')::uuid, (x->>'tecnico_id')::uuid, (x->>'equipe_id')::uuid
        from rk
      on conflict (empresa_id, chave) do nothing
      returning 1
    )
    select coalesce(array_agg('TEC1R:' || (x->>'visita_id') || ':' || (x->>'nivel')), '{}')
      into v_risco from rk;
    v_vigentes := v_vigentes || v_risco;

    -- 177: o resumo do dia fica "agora" a noite inteira, na cidade dele.
    v_vigentes := v_vigentes || array(
      select 'RESUMO:' || r.base_id || ':' || r.dia from resumo_dia r
       where r.empresa_id = v_emp and r.dia = v_hoje and r.base_id in (select bases_visiveis()));

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
    select v_emp, 'SUMIU:' || v.id, v_hoje, 'SUMIU_TOA',
           'Sumiu do TOA em andamento: ' || coalesce(t.nome, 'sem técnico'),
           concat_ws(' · ', case when v.contrato is not null then 'contrato ' || v.contrato end,
                     coalesce(sv.label, v.situacao), 'confira no TOA e corrija à mão'),
           v.id, v.tecnico_responsavel_id, v.equipe_id
      from visita v
      left join tecnico t on t.id = v.tecnico_responsavel_id
      left join situacao_visita sv on sv.codigo = v.situacao
     where v.empresa_id = v_emp and v.excluido_em is null
       and v.sumiu_do_toa_em is not null and v.data_agendada = v_hoje
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'SUMIU:' || v.id from visita v
       where v.empresa_id = v_emp and v.excluido_em is null
         and v.sumiu_do_toa_em is not null and v.data_agendada = v_hoje);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (c->>'corte'), v_hoje, 'RITMO',
           'Abaixo do ritmo até ' || (c->>'corte') || 'h: ' || (a->>'nome'),
           coalesce(a->>'detalhe',
                    (a->>'pontos') || ' de ' || (a->>'esperado') || ' pts esperados'),
           (a->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'ritmo', '[]')) c
      cross join jsonb_array_elements(c->'abaixo') a
      left join tecnico t on t.id = (a->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'RITMO:' || (a->>'tecnico_id') || ':' || v_hoje || ':' || (u.c->>'corte')
        from (select e.c from jsonb_array_elements(coalesce(v_c->'ritmo', '[]'))
                         with ordinality e(c, i)
               order by e.i desc limit 1) u
        cross join jsonb_array_elements(u.c->'abaixo') a);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas'), v_hoje, 'QUEBROU',
           'Contrato quebrado: ' || (q->>'nome'),
           (q->>'quebradas') || ' quebrado(s) hoje · −' || (q->>'pontos_perdidos') || ' pts',
           (q->>'tecnico_id')::uuid, t.equipe_id
      from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q
      left join tecnico t on t.id = (q->>'tecnico_id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'QUEBROU:' || (q->>'tecnico_id') || ':' || v_hoje || ':' || (q->>'quebradas')
        from jsonb_array_elements(coalesce(v_c->'quebrou', '[]')) q);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'CERCA:' || ev.id, v_hoje, 'CERCA',
           case ev.tipo when 'SAIU' then 'Saiu ' else 'Entrou ' end
             || case ce.tipo when 'GARAGEM' then 'da garagem ' else 'da área ' end
             || '"' || ce.nome || '": ' || coalesce(t.nome, 'técnico'),
           to_char(ev.em at time zone 'America/Manaus', 'HH24:MI'),
           ev.tecnico_id, ev.equipe_id
      from cerca_evento ev
      join cerca ce on ce.id = ev.cerca_id
      left join tecnico t on t.id = ev.tecnico_id
     where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
       and ((select ve_cidade_inteira()) or ev.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'CERCA:' || ev.id from cerca_evento ev
        join cerca_estado st on st.tecnico_id = ev.tecnico_id and st.cerca_id = ev.cerca_id
       where ev.empresa_id = v_emp and ev.alerta and ev.em >= v_ini
         and st.dentro = (ev.tipo = 'ENTROU') and st.desde = ev.em);

    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, equipe_id)
    select v_emp, 'GPS:' || ga.id, v_hoje, 'GPS',
           case ga.tipo
             when 'SIMULADO' then 'Localização simulada: '
             when 'DESLIGADO' then 'GPS desligado: '
             when 'SEM_PERMISSAO' then 'Localização negada: '
             when 'SALTO' then 'Salto de posição: '
             else 'Aparelho modificado: ' end || coalesce(t.nome, 'técnico'),
           concat_ws(' · ', to_char(ga.em at time zone 'America/Manaus', 'HH24:MI'), ga.detalhe),
           ga.tecnico_id, ga.equipe_id
      from gps_alerta ga
      left join tecnico t on t.id = ga.tecnico_id
     where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
       and ((select ve_cidade_inteira()) or ga.equipe_id in (select equipes_visiveis()))
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(
      select 'GPS:' || ga.id from gps_alerta ga
        left join tecnico_gps g on g.tecnico_id = ga.tecnico_id
       where ga.empresa_id = v_emp and ga.em >= v_ini and ga.tipo <> 'NORMALIZADO'
         and (ga.tipo in ('SALTO', 'APARELHO_MODIFICADO')
              or (g.estado = ga.tipo and g.desde = ga.em)));

    -- 178: o sincronismo — importação que não chegou, bucket sem computador,
    -- sessão do TOA caída. Sem equipe: a cidade vem do bucket.
    with al as materialized (
      select x from jsonb_array_elements(alertas_do_sincronismo()) x
    ), ins as (
      insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, base_id)
      select v_emp, x->>'chave', v_hoje, x->>'tipo', x->>'titulo', x->>'detalhe', (x->>'base_id')::uuid
        from al
      on conflict (empresa_id, chave) do nothing
      returning 1
    )
    select coalesce(array_agg(x->>'chave'), '{}') into v_sinc from al;
    v_vigentes := v_vigentes || v_sinc;

    -- 178: execução longa — só com o parâmetro ligado (aprovação do Emanuel).
    if coalesce((parametro_valor('execucao_longa')->>'ligado')::boolean, false) then
      with el as materialized (
        select x from jsonb_array_elements(execucao_longa()) x
      ), ins as (
        insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, visita_id, tecnico_id, equipe_id)
        select v_emp, 'LONGA:' || (x->>'visita_id'), v_hoje, 'EXECUCAO_LONGA',
               'Execução longa: ' || coalesce(x->>'tecnico', 'equipe ' || (x->>'equipe'), 'sem técnico'),
               concat_ws(' · ',
                 case when x->>'contrato' is not null then 'contrato ' || (x->>'contrato') end,
                 x->>'grupo',
                 'há ' || texto_duracao(make_interval(mins => (x->>'minutos')::int)),
                 'normal até ' || texto_duracao(make_interval(mins => (x->>'limite_min')::int))),
               (x->>'visita_id')::uuid, (x->>'tecnico_id')::uuid, (x->>'equipe_id')::uuid
          from el
        on conflict (empresa_id, chave) do nothing
        returning 1
      )
      select coalesce(array_agg('LONGA:' || (x->>'visita_id')), '{}') into v_longa from el;
      v_vigentes := v_vigentes || v_longa;
    end if;
  end if;

  if v_c ? 'material' then
    -- 155c: o tecnico vai junto -- e dele que o gatilho tira a cidade.
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id)
    select v_emp, 'MATERIAL:' || (m->>'id'), v_hoje, 'MATERIAL',
           case m->>'tipo' when 'FALTANDO' then 'Faltando: ' else 'Com defeito: ' end || coalesce(m->>'item', '—'),
           m->>'tecnico', sm.tecnico_id
      from jsonb_array_elements(v_c->'material') m
      left join sinalizacao_material sm on sm.id = (m->>'id')::uuid
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'MATERIAL:' || (m->>'id') from jsonb_array_elements(v_c->'material') m);
  end if;

  if v_c ? 'abastecimento' then
    insert into sinal (empresa_id, chave, dia, tipo, titulo, detalhe, tecnico_id, base_id)
    select v_emp, 'ABAST:' || (a->>'id'), v_hoje, 'ABASTECIMENTO',
           'Abastecimento pedido: ' || (a->>'placa'),
           concat_ws(' · ', a->>'tecnico', 'R$ ' || (a->>'valor')),
           ab.tecnico_id, coalesce(t.base_id, ve.base_id)
      from jsonb_array_elements(v_c->'abastecimento') a
      left join abastecimento ab on ab.id = (a->>'id')::uuid
      left join tecnico t on t.id = ab.tecnico_id
      left join veiculo ve on ve.id = ab.veiculo_id
    on conflict (empresa_id, chave) do nothing;
    v_vigentes := v_vigentes || array(select 'ABAST:' || (a->>'id') from jsonb_array_elements(v_c->'abastecimento') a);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tipo', s.tipo, 'titulo', s.titulo, 'detalhe', s.detalhe,
           'visita_id', s.visita_id, 'tecnico_id', s.tecnico_id, 'criado_em', s.criado_em,
           'equipe', eq.codigo, 'contrato', vv.contrato, 'contratos', qb.lista,
           'vigente', s.chave = any(v_vigentes)
                       or (s.tipo = 'DOIS_ATIVOS' and outros_ativos(s.visita_id) is not null)
                       -- 262 (D-376): o node em degradação vale o dia todo
                       or s.tipo = 'NODE_DEGRADACAO',
           'dispensado', d.sinal_id is not null) order by s.criado_em desc), '[]'::jsonb)
    into v_sinais
    from sinal s
    left join sinal_dispensa d on d.sinal_id = s.id and d.usuario_id = auth.uid()
    -- 160a: equipe, contrato e (no quebrado) os contratos do tecnico hoje.
    left join equipe eq on eq.id = s.equipe_id
    left join visita vv on vv.id = s.visita_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('visita_id', v2.id, 'contrato', v2.contrato)
                       order by v2.janela_inicio nulls last) as lista
        from visita v2
        left join tipo_atividade ta2 on ta2.id = v2.tipo_atividade_id
       where s.tipo = 'QUEBROU'
         and v2.tecnico_responsavel_id = s.tecnico_id
         and v2.data_agendada = s.dia
         and v2.excluido_em is null
         and coalesce(ta2.natureza, 'PRODUTIVA') <> 'JORNADA'
         and exists (select 1 from ordem_servico o
                       join codigo_baixa c on c.id = o.codigo_baixa_id
                      where o.visita_id = v2.id and c.natureza = 'IMPRODUTIVA')
    ) qb on true
   where s.empresa_id = v_emp and s.dia = v_hoje
     -- 155c: a CIDADE ATIVA manda. Sinal sem cidade nao existe mais (o
     -- gatilho da 155b carimba), mas se um dia aparecer, ele some da
     -- tela de todo mundo em vez de aparecer para todo mundo: sinal que
     -- nao sabe de onde e nao deve tocar em cidade nenhuma.
     and s.base_id in (select bases_visiveis())
     and case
           -- 262 (D-376): não tem equipe — só quem vê a cidade inteira
           when s.tipo = 'NODE_DEGRADACAO' then v_gestao and (select ve_cidade_inteira())
           when s.tipo in ('AJUDA','TEC1','RITMO','QUEBROU','CERCA','GPS','DOIS_ATIVOS','SUMIU_TOA','LOCAL','ATRASO','TEC1_RISCO','RESUMO',
                         'SEM_IMPORTACAO','SEM_COMPUTADOR','TOA_SESSAO','EXECUCAO_LONGA')
             then v_gestao and ((select ve_cidade_inteira()) or s.equipe_id in (select equipes_visiveis()))
           when s.tipo = 'MATERIAL' then tem_permissao('almoxarifado.ver')
           when s.tipo = 'ABASTECIMENTO' then tem_permissao('frota.ver')
           else false
         end;

  return jsonb_build_object('central', v_c, 'sinais', v_sinais);
end;
$function$;

-- O relógio: a porta única aprende o nome, e o pg_cron grava o aviso de hora em hora,
-- 07h20–18h20 de Manaus (11h20–22h20 UTC).
create or replace function public.rodar_por_cidade(p_funcao text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  if p_funcao not in ('sinais_do_dia', 'gerar_resumo_do_dia', 'recalcular_risco_quebra',
                      'tirar_foto_do_dia', 'recalcular_risco_revisita',
                      'registrar_nodes_em_degradacao') then
    raise exception 'rodar_por_cidade: % não está na lista.', p_funcao;
  end if;

  for r in
    select b.id as base_id, a.usuario_id
      from base b
      cross join lateral (
        select up.usuario_id
          from usuario_papel up
          join perfil p on p.id = up.usuario_id
         where up.papel = 'ADMIN' and p.empresa_id = b.empresa_id and p.ativo
         order by p.criado_em
         limit 1) a
     where b.ativo
       and (exists (select 1 from visita v
                     where v.base_id = b.id and v.data_agendada = hoje_local()
                       and v.excluido_em is null)
            -- 178: bucket em uso (importação nos últimos 7 dias) também conta.
            or (p_funcao = 'sinais_do_dia'
                and exists (select 1 from importacao i
                             where i.base_id = b.id and i.status = 'APLICADA'
                               and i.criado_em >= now() - interval '7 days')))
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.usuario_id, 'role', 'authenticated')::text, true);
    perform set_config('request.headers',
      json_build_object('x-afline-cidade', r.base_id)::text, true);
    perform set_config('app.bases_visiveis', '', true);
    perform set_config('app.pelo_relogio', '1', true);
    begin
      execute format('select %I()', p_funcao);
      n := n + 1;
    exception when others then
      -- Uma cidade com defeito não cala as outras.
      raise warning 'rodar_por_cidade(%), cidade %: %', p_funcao, r.base_id, sqlerrm;
    end;
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('app.bases_visiveis', '', true);
  perform set_config('app.pelo_relogio', '', true);
  return n;
end;
$function$;

select cron.unschedule('node-em-degradacao') where exists (select 1 from cron.job where jobname = 'node-em-degradacao');
select cron.schedule('node-em-degradacao', '20 11-22 * * *',
                     $$select public.rodar_por_cidade('registrar_nodes_em_degradacao')$$);

notify pgrst, 'reload schema';
