-- ┌─ 261 · Risco de revisita na baixa (D-375) — fase 2 do pacote preditivo ─┐
-- │                                                                        │
-- │ O QUE RESOLVE                                                          │
-- │   A revisita (D-245, D-363, D-371) só aparece DEPOIS: o serviço volta  │
-- │   em até 30 dias e pesa no indicador da equipe. Pacote de inteligência │
-- │   (D-262): no dia da baixa, dizer quais serviços têm cara de voltar,   │
-- │   com o motivo, para a gestão conferir antes de a revisita acontecer.  │
-- │                                                                        │
-- │ O QUE NÃO FAZ (D-262)                                                  │
-- │   É SUGESTÃO para a gestão, no site. Nada muda sozinho, nada vai para  │
-- │   o app do técnico, nenhum aviso no sino, nenhuma trava na baixa.      │
-- │                                                                        │
-- │ RESPOSTAS DO EMANUEL (12/11), sobre a medida abaixo:                   │
-- │   · a nota é só do serviço CONCLUÍDO — a VT reagendada ou cancelada    │
-- │     volta "por construção" (27–37%) e escondia a concluída; ela sai da │
-- │     nota e da régua e aparece à parte, "vai voltar";                   │
-- │   · o Retorno fica ALTO por ser Retorno, com o motivo escrito;         │
-- │   · três faixas, como no Risco de quebra; a validação REGULAR do sinal │
-- │     é um selo informativo, fora da conta (só o que aumenta pesa);      │
-- │   · publicar já: sinal e LOG entram sozinhos quando novembro fechar.   │
-- │                                                                        │
-- │ QUEM É "SERVIÇO QUE PODE GERAR REVISITA" (a régua da 256, D-371)       │
-- │   VT  · VISITA TECNICA concluída, reagendada ou cancelada — sem        │
-- │         Auditar (800 da AFLINE) e sem cancelado pela central.          │
-- │         Voltou = é a anterior de alguma VT em `revisita_30d_vt`        │
-- │         (D-363) — a VT nova também sem Auditar e sem central.          │
-- │   INST· ADESAO, MIGRACAO GPON, REINSTALACAO, MUDANCA DE ENDERECO ou    │
-- │         RETORNO DE CREDENCIADA concluídos. Voltou = é a anterior de    │
-- │         um Retorno com `revisita_dos_contratos(...).revisita` (D-245). │
-- │   A regra de revisita NÃO é escrita de novo: as duas funções decidem.  │
-- │   Sem contrato não há como voltar: fica fora (como nas funções).       │
-- │                                                                        │
-- │ DE ONDE VEM CADA NÚMERO (nenhum peso escrito à mão — o método da 181)  │
-- │   Para cada cidade, cada dia e cada família de serviço (VT, INST), a   │
-- │   régua sai do histórico da PRÓPRIA cidade: serviços de D−121 a D−31   │
-- │   (90 dias cuja janela de 30 dias JÁ FECHOU antes do dia), e a         │
-- │   revisita só conta se aconteceu até D−1. Para cada fator (família +   │
-- │   valor): taxa de revisita e a RAZÃO contra a taxa da cidade,          │
-- │   suavizada (20 serviços "fantasmas"). Vale (aceito) com as três: 30+  │
-- │   serviços; piso de Wilson (95% unilateral) acima da taxa da cidade; e │
-- │   razão de 1,25+. A cidade precisa de 300 serviços na janela; menos    │
-- │   que isso é "sem histórico", nunca "baixo" (regra 6).                 │
-- │                                                                        │
-- │ AS FAMÍLIAS CANDIDATAS (o dado decide quais valores entram, todo dia)  │
-- │   SITUACAO (VT) · GRUPO (INST) · CODIGO (a baixa principal: a da       │
-- │   operadora na menor sequência; sem ela, a da AFLINE — a mesma de      │
-- │   `revisita_30d_vt`) · NODE · BAIRRO · JANELA (hora de início) ·       │
-- │   TECNICO (o responsável; no histórico do ngestor, o técnico ATIVO     │
-- │   único da equipe — a regra da 256/220, D-328) · REINCIDENTE (o        │
-- │   próprio serviço já é revisita, pelas mesmas funções) ·               │
-- │   SINAL (VT: `classe_certidao` da Validação no portal; SEM_LEITURA e   │
-- │   OS_NAO_FINALIZADA são valores à parte, nunca "bom"; só a partir do   │
-- │   1º dia com leitura NA CIDADE — antes disso não havia portal) ·       │
-- │   LOG ("Contador de log", 0/1/2/3+) · EVIDENCIA (COM/SEM; só fora da   │
-- │   carga do ngestor, que não tem app) · DURACAO (início→fim do TOA, só  │
-- │   com Status da Atividade CONCLUIDO/NAO CONCLUIDO, em faixas de        │
-- │   15/30/60 min — a régua diz qual faixa pesa; nenhuma é "curta" aqui). │
-- │   Fora, medido: AREA (0 valores aceitos em 4 réguas — 4 a 6 áreas por  │
-- │   cidade, largas demais) e EQUIPE (repete o TECNICO). Modelo de        │
-- │   equipamento fica com a 180 (só ~20% das visitas têm leitura).        │
-- │   SINAL, LOG, EVIDENCIA e DURACAO não existem na carga do ngestor      │
-- │   (jan–out): só passam a pesar quando os serviços de novembro fecharem │
-- │   30 dias (a partir de ~02/12) — sem validação para trás até lá.       │
-- │                                                                        │
-- │ A FAIXA                                                                │
-- │   Fatores PARENTES não se multiplicam duas vezes: NODE e BAIRRO são o  │
-- │   mesmo lugar; SITUACAO e CODIGO, o mesmo resultado; GRUPO e           │
-- │   REINCIDENTE, a mesma história (Retorno que já é revisita). Em cada   │
-- │   grupo de parentes vale a MAIOR razão; o fator do serviço é o produto │
-- │   entre grupos. ALTO = 2× a taxa da cidade ou mais · MÉDIO = algum     │
-- │   motivo · BAIXO = nenhum. Só fatores que AUMENTAM o risco viram       │
-- │   motivo (como na 181).                                                │
-- │                                                                        │
-- │ VALIDADO PARA TRÁS (12/11, como authenticated, ver o relatório)        │
-- │   VT: régua de 01/09 (serviços 03/05–01/08), teste 01/09–12/10.        │
-- │   INST: régua de 01/04 (serviços jan–01/03), teste 01–30/04 (a carga   │
-- │   do ngestor não tem instalação de junho a outubro).                   │
-- │   Taxa real de revisita na faixa ALTO × a base do período de teste:    │
-- │     Manaus   VT   32,8% × 16,3% (638 de 3.178; pega 40% das revisitas) │
-- │              INST 18,9% ×  9,2% (428 de 3.678; pega 24%)               │
-- │     São Luís VT   25,6% × 16,2% (391 de 2.338; pega 27%)               │
-- │              INST 27,7% × 13,8% (137 de 646; pega 43%)                 │
-- │   MÉDIO ficou na base (0,95× a 1,16×). O ALTO da VT é quase todo       │
-- │   reagendada/cancelada/código improdutivo: na VT CONCLUÍDA o ALTO é    │
-- │   3,3% (Manaus, 21,2% × 12,0%) e 1,0% (São Luís). O ALTO da INST é     │
-- │   quase todo Retorno: sem Retorno, nenhuma faixa separa.               │
-- │                                                                        │
-- │ CUSTO                                                                  │
-- │   A régua fica em `risco_revisita_fator`, uma por cidade por dia. A    │
-- │   tela calcula na primeira leitura do dia se o relógio não calculou.   │
-- │   PARA O RELÓGIO (não feito aqui): acrescentar                         │
-- │   'recalcular_risco_revisita' na lista fechada de `rodar_por_cidade`   │
-- │   (a versão viva, da 260) e então agendar:                             │
-- │     select cron.schedule('risco-de-revisita', '40 9 * * *',            │
-- │       $$select public.rodar_por_cidade('recalcular_risco_revisita')$$);│
-- └────────────────────────────────────────────────────────────────────────┘

create table if not exists public.risco_revisita_fator (
  empresa_id   uuid not null references empresa(id),
  base_id      uuid not null references base(id),
  dia          date not null,        -- o dia que esta régua serve (ela vem de antes dele)
  servico      text not null check (servico in ('VT', 'INST')),
  familia      text not null,        -- BASE = a taxa da cidade
  valor        text not null,
  n            integer not null,
  revisitas    integer not null,
  taxa         numeric not null,     -- revisitas / n (0 quando n = 0)
  razao        numeric,              -- suavizada ÷ taxa da cidade
  piso         numeric,              -- Wilson 95% unilateral
  aceito       boolean not null,
  de           date not null,
  ate          date not null,
  calculado_em timestamptz not null default now(),
  primary key (base_id, dia, servico, familia, valor)
);
alter table public.risco_revisita_fator enable row level security;
revoke all on table public.risco_revisita_fator from public, anon, authenticated;
-- Leitura: a gestão, na cidade visível. Escrita: nenhuma policy — só as
-- funções SECURITY DEFINER abaixo gravam.
grant select on table public.risco_revisita_fator to authenticated;
drop policy if exists risco_revisita_fator_leitura on public.risco_revisita_fator;
create policy risco_revisita_fator_leitura on public.risco_revisita_fator
  for select to authenticated
  using (empresa_id = (select minha_empresa())
         and (select eh_gestao())
         and base_id in (select bases_visiveis()));

/*
 * Os serviços que podem gerar revisita, de uma cidade num intervalo de dias.
 * A mesma lista serve a régua (o passado) e a tela (o dia).
 */
create or replace function public._risco_revisita_servicos(p_base uuid, p_de date, p_ate date)
returns table (visita_id uuid, servico text)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, case when g.nome = 'VISITA TECNICA' then 'VT' else 'INST' end
    from visita v
    join tipo_servico g on g.id = v.tipo_servico_id
     and g.nome in ('VISITA TECNICA', 'RETORNO DE CREDENCIADA', 'ADESAO', 'MIGRACAO GPON',
                    'REINSTALACAO', 'MUDANCA DE ENDERECO')
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.base_id = p_base and v.excluido_em is null
     and v.data_agendada between p_de and p_ate
     and v.contrato is not null
     and coalesce(ta.natureza, '') <> 'JORNADA'
     -- 261 (D-375): só o CONCLUÍDO tem nota — a VT reagendada/cancelada vai à parte
     and v.situacao = 'CONCLUIDA'
     -- Auditar e cancelado pela central não são serviço (256, D-363)
     and not (v.situacao = 'CANCELADA' and (
           v.cancelado_central_em is not null
           or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                     v.dados_origem->>'Motivo de Fechamento Externo')
           or exists (select 1 from ordem_servico o
                        join codigo_baixa c8 on c8.id = o.codigo_baixa_afline_id
                       where o.visita_id = v.id and c8.codigo = 800)));
$$;
revoke all on function public._risco_revisita_servicos(uuid, date, date) from public, anon, authenticated;

/*
 * Quem VOLTOU: para cada serviço, a primeira revisita (VT ← VT pela
 * `revisita_30d_vt`; Retorno ← instalação/Retorno pela
 * `revisita_dos_contratos`) registrada até `p_ate`. A visita nova também não
 * conta se for Auditar ou cancelada pela central (256).
 * DEFINER: a revisita pode ser de outra equipe; a resposta não leva dado do
 * cliente. Fechada a authenticated.
 */
create or replace function public._risco_revisita_voltou(p_servicos uuid[], p_ate date)
returns table (visita_id uuid, revisita_id uuid, revisita_dia date, dias integer)
language sql
stable
security definer
set search_path = public
as $$
  with s as materialized (
    select v.id, v.empresa_id, v.contrato, v.data_agendada as dia,
           (g.nome = 'VISITA TECNICA') as vt
      from visita v
      join tipo_servico g on g.id = v.tipo_servico_id
     where v.id = any (p_servicos) and v.contrato is not null
  ),
  ctr as materialized (select distinct s.empresa_id, s.contrato, s.vt from s),
  cand as materialized (
    select n.id, c.vt
      from ctr c
      join visita n on n.empresa_id = c.empresa_id and n.contrato = c.contrato
                   and n.excluido_em is null
      join tipo_servico g on g.id = n.tipo_servico_id
       and g.nome = case when c.vt then 'VISITA TECNICA' else 'RETORNO DE CREDENCIADA' end
     where n.data_agendada between (select min(s.dia) from s) and p_ate
       and not (n.situacao = 'CANCELADA' and (
             n.cancelado_central_em is not null
             or cancelado_pela_central(n.dados_origem->>'Status da Atividade',
                                       n.dados_origem->>'Motivo de Fechamento Externo')
             or exists (select 1 from ordem_servico o
                          join codigo_baixa c8 on c8.id = o.codigo_baixa_afline_id
                         where o.visita_id = n.id and c8.codigo = 800)))
  ),
  r as materialized (
    select x.visita_id, x.anterior_id, x.dias
      from revisita_30d_vt((select coalesce(array_agg(cand.id), '{}') from cand where cand.vt)) x
     where x.anterior_id is not null
    union all
    select x.visita_id, x.anterior_id, x.dias
      from revisita_dos_contratos((select coalesce(array_agg(cand.id), '{}') from cand where not cand.vt)) x
     where x.revisita
  )
  select distinct on (r.anterior_id) r.anterior_id, r.visita_id, n.data_agendada, r.dias
    from r
    join s on s.id = r.anterior_id
    join visita n on n.id = r.visita_id
   order by r.anterior_id, n.data_agendada, n.criado_em;
$$;
revoke all on function public._risco_revisita_voltou(uuid[], date) from public, anon, authenticated;

/*
 * Os fatores de cada serviço, um por linha (família, valor, detalhe).
 * A MESMA função serve a régua e o dia: o que se mede é o que se aplica.
 * Nada aqui olha para DEPOIS do serviço (a REINCIDENTE olha para trás).
 */
create or replace function public._risco_revisita_fatores(p_visitas uuid[])
returns table (visita_id uuid, familia text, valor text, detalhe text)
language sql
stable
security definer
set search_path = public
as $$
  with equipe_tec as materialized (
    -- "a equipe é a pessoa" (220, D-328): o técnico ATIVO único da equipe
    select t.equipe_id, (array_agg(t.id))[1] as tec
      from tecnico t where t.situacao = 'ATIVO' and t.equipe_id is not null
     group by t.equipe_id having count(*) = 1
  ),
  alvo as materialized (
    select v.id, v.base_id, v.data_agendada as dia, g.nome as grupo,
           (g.nome = 'VISITA TECNICA') as vt, v.situacao,
           nullif(btrim(v.node), '') as node,
           nullif(norm_txt(v.bairro), '') as bairro, v.janela_inicio,
           coalesce(v.tecnico_responsavel_id, et.tec) as tec,
           case when btrim(v.dados_origem->>'Contador de log') ~ '^\d+$'
                then btrim(v.dados_origem->>'Contador de log')::int end as clog,
           coalesce(v.dados_origem ? 'ID ngestor', false) as da_carga,
           case when norm_txt(coalesce(v.dados_origem->>'Status da Atividade', ''))
                       in ('CONCLUIDO', 'NAO CONCLUIDO')
                 and v.inicio is not null and v.fim > v.inicio
                then extract(epoch from v.fim - v.inicio) / 60 end as minutos
      from visita v
      join tipo_servico g on g.id = v.tipo_servico_id
      left join equipe_tec et on et.equipe_id = v.equipe_id
     where v.id = any (p_visitas)
  ),
  cod as materialized (
    select a.id, cb.codigo, cb.descricao
      from alvo a
      cross join lateral (
        select coalesce(o.codigo_baixa_id, o.codigo_baixa_afline_id) as cid
          from ordem_servico o
         where o.visita_id = a.id
           and (o.codigo_baixa_id is not null or o.codigo_baixa_afline_id is not null)
         order by (o.codigo_baixa_id is null), o.sequencia
         limit 1) ob
      join codigo_baixa cb on cb.id = ob.cid
  ),
  rein as materialized (
    select x.visita_id, x.anterior_data
      from revisita_30d_vt((select coalesce(array_agg(a.id), '{}') from alvo a where a.vt)) x
     where x.anterior_id is not null
    union all
    select x.visita_id, x.anterior_data
      from revisita_dos_contratos((select coalesce(array_agg(a.id), '{}') from alvo a
                                    where a.grupo = 'RETORNO DE CREDENCIADA')) x
     where x.revisita
  ),
  -- o portal da Claro começou num dia em cada cidade; antes dele não há leitura
  ini as materialized (
    select sc.base_id, min(sc.dia) as desde
      from sinal_claro sc
     where sc.base_id in (select distinct a.base_id from alvo a)
     group by sc.base_id
  ),
  sin as materialized (
    select a.id,
           case when sc.visita_id is null then 'SEM_LEITURA'
                else coalesce(classe_certidao(sc.status_os_texto, sc.validacao_cor), 'OS_NAO_FINALIZADA')
           end as classe,
           sc.validacao_texto
      from alvo a
      join ini on ini.base_id = a.base_id and a.dia >= ini.desde
      left join sinal_claro sc on sc.visita_id = a.id
     where a.vt
  )
  select a.id, 'GRUPO', a.grupo, null::text from alvo a where not a.vt
  union all
  select c.id, 'CODIGO', c.codigo::text, c.codigo || ' - ' || c.descricao from cod c
  union all
  select a.id, 'NODE', a.node, null from alvo a where a.node is not null
  union all
  select a.id, 'BAIRRO', a.bairro, null from alvo a where a.bairro is not null
  union all
  select a.id, 'JANELA', to_char(a.janela_inicio, 'HH24') || 'h', null
    from alvo a where a.janela_inicio is not null
  union all
  select a.id, 'TECNICO', a.tec::text, t.nome
    from alvo a join tecnico t on t.id = a.tec
  union all
  select r.visita_id, 'REINCIDENTE', 'SIM', 'já é revisita de ' || to_char(r.anterior_data, 'DD/MM')
    from rein r
  union all
  select s.id, 'SINAL', s.classe, s.validacao_texto from sin s
  union all
  select a.id, 'LOG', case when a.clog >= 3 then '3+' else a.clog::text end, null
    from alvo a where a.clog is not null
  union all
  select a.id, 'EVIDENCIA',
         case when exists (select 1 from evidencia e where e.visita_id = a.id) then 'COM' else 'SEM' end,
         null
    from alvo a where not a.da_carga
  union all
  select a.id, 'DURACAO',
         case when a.minutos < 15 then 'ATE_15' when a.minutos < 30 then '15_30'
              when a.minutos < 60 then '30_60' else '60_MAIS' end,
         round(a.minutos)::int || ' min'
    from alvo a where a.minutos is not null;
$$;
revoke all on function public._risco_revisita_fatores(uuid[]) from public, anon, authenticated;

/*
 * A régua de uma cidade para um dia. Interna: só a leitura e o relógio chamam.
 */
create or replace function public._recalcular_risco_revisita(p_base uuid, p_dia date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_de  date := p_dia - 121;     -- 90 dias de serviços…
  v_ate date := p_dia - 31;      -- …cuja janela de 30 dias fechou antes do dia
  v_linhas int;
  z constant numeric := 1.645;   -- 95% unilateral
  k constant numeric := 20;      -- serviços "fantasmas" da suavização
begin
  select b.empresa_id into v_emp from base b where b.id = p_base;
  if v_emp is null then return 0; end if;

  delete from risco_revisita_fator where base_id = p_base and dia = p_dia;
  -- Guarda 90 dias de régua (para responder "por que estava alto no dia X").
  delete from risco_revisita_fator where base_id = p_base and dia < p_dia - 90;

  insert into risco_revisita_fator (empresa_id, base_id, dia, servico, familia, valor, n,
                                    revisitas, taxa, razao, piso, aceito, de, ate)
  with srv as materialized (
    select * from _risco_revisita_servicos(p_base, v_de, v_ate)
  ),
  -- só a revisita que já tinha acontecido ANTES do dia
  vol as materialized (
    select x.visita_id
      from _risco_revisita_voltou((select coalesce(array_agg(srv.visita_id), '{}') from srv), p_dia - 1) x
  ),
  hist as materialized (
    select srv.visita_id, srv.servico, (vol.visita_id is not null) as voltou
      from srv left join vol on vol.visita_id = srv.visita_id
  ),
  b as materialized (
    select fam.servico, count(h.visita_id)::int as n,
           (count(*) filter (where h.voltou))::int as q
      from (values ('VT'), ('INST')) fam(servico)
      left join hist h on h.servico = fam.servico
     group by fam.servico
  ),
  fat as materialized (
    select * from _risco_revisita_fatores((select coalesce(array_agg(srv.visita_id), '{}') from srv))
  ),
  y as (
    select h.servico, fat.familia, fat.valor, count(*)::int as n,
           (count(*) filter (where h.voltou))::int as q
      from hist h join fat on fat.visita_id = h.visita_id
     group by 1, 2, 3
  )
  select v_emp, p_base, p_dia, b.servico, 'BASE', '*', b.n, b.q,
         case when b.n > 0 then b.q::numeric / b.n else 0 end, 1, null,
         b.n >= 300 and b.q > 0, v_de, v_ate
    from b
  union all
  select v_emp, p_base, p_dia, y.servico, y.familia, y.valor, y.n, y.q, w.p,
         round(((y.q + k * w.pb) / (y.n + k)) / w.pb, 3),
         round(w.lb, 4),
         b.n >= 300 and y.n >= 30 and w.lb > w.pb
           and ((y.q + k * w.pb) / (y.n + k)) / w.pb >= 1.25,
         v_de, v_ate
    from y
    join b on b.servico = y.servico and b.q > 0
    cross join lateral (
      select y.q::numeric / y.n as p, b.q::numeric / b.n as pb,
             -- Wilson: piso do intervalo
             ((y.q::numeric / y.n) + z * z / (2 * y.n)
               - z * sqrt((y.q::numeric / y.n) * (1 - y.q::numeric / y.n) / y.n + z * z / (4.0 * y.n * y.n)))
               / (1 + z * z / y.n) as lb) w;

  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;
revoke all on function public._recalcular_risco_revisita(uuid, date) from public, anon, authenticated;

/*
 * A faixa de cada serviço, com a régua de um dia (a do dia do serviço, na
 * tela; a de um dia de corte, na validação para trás).
 */
create or replace function public._risco_revisita_pontuar(p_visitas uuid[], p_regua date)
returns table (visita_id uuid, servico text, faixa text, fator numeric, motivos jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with vis as materialized (
    select v.id, v.base_id,
           case when g.nome = 'VISITA TECNICA' then 'VT' else 'INST' end as servico
      from visita v join tipo_servico g on g.id = v.tipo_servico_id
     where v.id = any (p_visitas)
  ),
  base as materialized (
    select r.base_id, r.servico, r.aceito from risco_revisita_fator r
     where r.dia = p_regua and r.familia = 'BASE'
       and r.base_id in (select distinct vis.base_id from vis)
  ),
  mot as materialized (
    select f.visita_id, f.familia, f.valor, f.detalhe, r.taxa, r.razao, r.n,
           -- parentes: o mesmo lugar, o mesmo resultado, a mesma história
           case when f.familia in ('NODE', 'BAIRRO') then 'LUGAR'
                when f.familia in ('SITUACAO', 'CODIGO') then 'RESULTADO'
                when f.familia in ('GRUPO', 'REINCIDENTE') then 'HISTORIA'
                else f.familia end as parente
      from _risco_revisita_fatores(p_visitas) f
      join vis on vis.id = f.visita_id
      join risco_revisita_fator r on r.base_id = vis.base_id and r.dia = p_regua
                                 and r.servico = vis.servico
                                 and r.familia = f.familia and r.valor = f.valor and r.aceito
  ),
  grp as (
    select mot.visita_id, mot.parente, max(mot.razao) as razao from mot group by 1, 2
  ),
  fat as (
    select grp.visita_id, exp(sum(ln(grp.razao))) as fator, count(*) as ng from grp group by 1
  ),
  mj as (
    select mot.visita_id,
           jsonb_agg(jsonb_build_object(
             'familia', mot.familia, 'valor', mot.valor, 'detalhe', mot.detalhe,
             'taxa', round(mot.taxa * 100, 1), 'razao', mot.razao, 'n', mot.n)
             order by mot.razao desc) as motivos
      from mot group by 1
  )
  select vis.id, vis.servico,
         case when b.aceito is not true then 'SEM_HISTORICO'
              when fat.fator >= 2 then 'ALTO'
              when fat.ng > 0 then 'MEDIO'
              else 'BAIXO' end,
         case when b.aceito then round(coalesce(fat.fator, 1), 2) end,
         case when b.aceito then coalesce(mj.motivos, '[]') else '[]' end
    from vis
    left join base b on b.base_id = vis.base_id and b.servico = vis.servico
    left join fat on fat.visita_id = vis.id
    left join mj on mj.visita_id = vis.id;
$$;
revoke all on function public._risco_revisita_pontuar(uuid[], date) from public, anon, authenticated;

/*
 * A régua de hoje da cidade ativa — a porta do relógio (`rodar_por_cidade`).
 */
create or replace function public.recalcular_risco_revisita()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_base uuid;
begin
  if not eh_gestao() then
    raise exception 'O risco de revisita é da gestão.' using errcode = '42501';
  end if;
  select case when count(*) = 1 then min(b::text)::uuid end into v_base from bases_visiveis() b;
  if v_base is null then
    raise exception 'Escolha uma cidade no topo.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('risco_revisita:' || v_base));
  return _recalcular_risco_revisita(v_base, hoje_local());
end;
$$;
revoke all on function public.recalcular_risco_revisita() from public, anon, authenticated;

/*
 * A tela: os serviços BAIXADOS no dia (padrão hoje; até 90 dias atrás), da
 * cidade ativa, com a faixa, os motivos e — para conferir — se já voltou.
 * Calcula a régua do dia na primeira leitura, se o relógio ainda não calculou.
 */
create or replace function public.risco_revisita_do_dia(p_dia date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := hoje_local();
  v_dia  date := coalesce(p_dia, hoje_local());
  v_emp  uuid := minha_empresa();
  v_base uuid;
  v_vis  uuid[];
  v_out  jsonb;
begin
  if not eh_gestao() then
    raise exception 'O risco de revisita é da gestão.' using errcode = '42501';
  end if;
  if v_dia > v_hoje or v_dia < v_hoje - 90 then
    raise exception 'Escolha um dia dos últimos 90.' using errcode = '22023';
  end if;
  select case when count(*) = 1 then min(b::text)::uuid end into v_base from bases_visiveis() b;
  if v_base is null then
    raise exception 'Escolha uma cidade no topo.' using errcode = '22023';
  end if;

  if not exists (select 1 from risco_revisita_fator
                  where base_id = v_base and dia = v_dia and familia = 'BASE') then
    perform pg_advisory_xact_lock(hashtext('risco_revisita:' || v_base));
    if not exists (select 1 from risco_revisita_fator
                    where base_id = v_base and dia = v_dia and familia = 'BASE') then
      perform _recalcular_risco_revisita(v_base, v_dia);
    end if;
  end if;

  select coalesce(array_agg(s.visita_id), '{}') into v_vis
    from _risco_revisita_servicos(v_base, v_dia, v_dia) s
    join visita v on v.id = s.visita_id
   where v.empresa_id = v_emp
     and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()));

  select jsonb_build_object(
      'dia', v_dia, 'hoje', v_hoje,
      'cidade', (select b.nome from base b where b.id = v_base),
      'reguas', coalesce((select jsonb_object_agg(r.servico, jsonb_build_object(
          'n', r.n, 'revisitas', r.revisitas, 'taxa', round(r.taxa * 100, 1),
          'de', r.de, 'ate', r.ate, 'suficiente', r.aceito, 'calculado_em', r.calculado_em,
          'fatores', (select coalesce(jsonb_agg(jsonb_build_object(
                         'familia', f.familia, 'valor', f.valor,
                         'rotulo', case f.familia
                                     when 'TECNICO' then (select t.nome from tecnico t where t.id::text = f.valor)
                                     when 'CODIGO' then (select f.valor || ' - ' || min(cb.descricao) from codigo_baixa cb
                                                          where cb.codigo::text = f.valor
                                                            and (cb.empresa_id is null or cb.empresa_id = v_emp))
                                   end,
                         'n', f.n, 'revisitas', f.revisitas, 'taxa', round(f.taxa * 100, 1),
                         'razao', f.razao) order by f.razao desc), '[]')
                        from risco_revisita_fator f
                       where f.base_id = v_base and f.dia = v_dia and f.servico = r.servico
                         and f.aceito and f.familia <> 'BASE')))
        from risco_revisita_fator r
       where r.base_id = v_base and r.dia = v_dia and r.familia = 'BASE'), '{}'),
      'servicos', coalesce((select jsonb_agg(jsonb_build_object(
          'visita_id', v.id, 'contrato', v.contrato, 'servico', p.servico, 'grupo', ts.nome,
          'bairro', v.bairro, 'situacao', v.situacao, 'situacao_label', sv.label,
          'equipe_id', v.equipe_id, 'equipe', e.codigo, 'tecnico', t.nome,
          'baixa', (select cb.codigo || ' - ' || cb.descricao
                      from ordem_servico o
                      join codigo_baixa cb on cb.id = coalesce(o.codigo_baixa_id, o.codigo_baixa_afline_id)
                     where o.visita_id = v.id
                     order by (o.codigo_baixa_id is null), o.sequencia limit 1),
          'faixa', p.faixa, 'fator', p.fator, 'motivos', p.motivos,
          -- o selo: a classe da certidão da VT (REGULAR = validado sem falha), fora da conta
          'sinal', (select classe_certidao(sc.status_os_texto, sc.validacao_cor)
                      from sinal_claro sc where sc.visita_id = v.id),
          'voltou', case when vo.visita_id is null then null
                         else jsonb_build_object('visita_id', vo.revisita_id, 'dia', vo.revisita_dia,
                                                 'dias', vo.dias) end)
          order by case p.faixa when 'ALTO' then 0 when 'MEDIO' then 1 when 'BAIXO' then 2 else 3 end,
                   p.fator desc nulls last, v.contrato)
        from _risco_revisita_pontuar(v_vis, v_dia) p
        join visita v on v.id = p.visita_id
        left join _risco_revisita_voltou(v_vis, v_hoje) vo on vo.visita_id = p.visita_id
        left join tipo_servico ts on ts.id = v.tipo_servico_id
        left join situacao_visita sv on sv.codigo = v.situacao
        left join equipe e on e.id = v.equipe_id
        left join tecnico t on t.id = v.tecnico_responsavel_id), '[]'),
      -- 261 (D-375): a VT reagendada ou cancelada do dia (sem Auditar, sem central) — sem
      -- nota: volta "por construção". Mostrada para a gestão saber quantas vão voltar.
      'vai_voltar', coalesce((
        with rc as materialized (
          select v.id from visita v
            join tipo_servico g on g.id = v.tipo_servico_id and g.nome = 'VISITA TECNICA'
            left join tipo_atividade ta on ta.id = v.tipo_atividade_id
           where v.base_id = v_base and v.empresa_id = v_emp and v.excluido_em is null
             and v.data_agendada = v_dia and v.contrato is not null
             and coalesce(ta.natureza, '') <> 'JORNADA'
             and v.situacao in ('REAGENDAMENTO', 'CANCELADA')
             and not (v.situacao = 'CANCELADA' and (
                   v.cancelado_central_em is not null
                   or cancelado_pela_central(v.dados_origem->>'Status da Atividade',
                                             v.dados_origem->>'Motivo de Fechamento Externo')
                   or exists (select 1 from ordem_servico o
                                join codigo_baixa c8 on c8.id = o.codigo_baixa_afline_id
                               where o.visita_id = v.id and c8.codigo = 800)))
             and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
        )
        select jsonb_agg(jsonb_build_object(
          'visita_id', v.id, 'contrato', v.contrato, 'situacao', v.situacao, 'situacao_label', sv.label,
          'equipe', e.codigo, 'tecnico', t.nome,
          'baixa', (select cb.codigo || ' - ' || cb.descricao
                      from ordem_servico o
                      join codigo_baixa cb on cb.id = coalesce(o.codigo_baixa_id, o.codigo_baixa_afline_id)
                     where o.visita_id = v.id
                     order by (o.codigo_baixa_id is null), o.sequencia limit 1),
          'voltou', case when vo.visita_id is null then null
                         else jsonb_build_object('visita_id', vo.revisita_id, 'dia', vo.revisita_dia,
                                                 'dias', vo.dias) end)
          order by v.situacao, e.codigo nulls last, v.contrato)
          from rc
          join visita v on v.id = rc.id
          left join _risco_revisita_voltou((select coalesce(array_agg(id), '{}') from rc), v_hoje) vo
                 on vo.visita_id = v.id
          left join situacao_visita sv on sv.codigo = v.situacao
          left join equipe e on e.id = v.equipe_id
          left join tecnico t on t.id = v.tecnico_responsavel_id), '[]')
    ) into v_out;

  return v_out;
end;
$$;
revoke all on function public.risco_revisita_do_dia(date) from public, anon;
grant execute on function public.risco_revisita_do_dia(date) to authenticated;

-- O relógio: a porta única (`rodar_por_cidade`, 260) aprende o nome, e o pg_cron agenda
-- às 05h40 de Manaus (09h40 UTC), antes de o dia começar.
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
                      'tirar_foto_do_dia', 'recalcular_risco_revisita') then
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

select cron.unschedule('risco-de-revisita') where exists (select 1 from cron.job where jobname = 'risco-de-revisita');
select cron.schedule('risco-de-revisita', '40 9 * * *',
                     $$select public.rodar_por_cidade('recalcular_risco_revisita')$$);

notify pgrst, 'reload schema';
