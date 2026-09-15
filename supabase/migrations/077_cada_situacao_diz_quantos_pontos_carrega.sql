-- ============================================================
-- 077 · Cada situação diz quantos pontos carrega
--
-- > "é bom colocar a soma da quantidade de pontos concluidos,
-- >  reagendados, em entrada [...] quantos pontos tem cada segmento de
-- >  status seria muito bom" — Emanuel, 15/09
--
-- ┌─ por que o número por situação não é enfeite ────────────────────┐
-- │ A 074 trouxe `pontos_concluidos`: quanto a equipe FEZ. Mas o que  │
-- │ decide o dia do controlador é o que ainda NÃO foi feito, e isso   │
-- │ o volume não responde. Seis contratos na entrada podem ser 5,5    │
-- │ pontos ou 0,9 — mesma barra, mesmo "6", faturamento seis vezes    │
-- │ diferente. DESCONEXÃO faz volume e quase não pontua; ADESÃO faz   │
-- │ menos volume e carrega o faturamento (mesma razão do volume ×     │
-- │ pontos no Dashboard). Sem o ponto ao lado da contagem, a régua de │
-- │ situação diz onde estão os CONTRATOS e cala sobre onde está o     │
-- │ DINHEIRO.                                                         │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ zero e desconhecido não são a mesma coisa (D-117) ──────────────┐
-- │ Medido agora, no dia 15/09: a CANCELADA da equipe 001 tem 1       │
-- │ contrato e NENHUMA regra de pontuação. Somar isso como 0,00       │
-- │ afirma "este serviço não vale nada" — e não é o que sabemos; o    │
-- │ que sabemos é que não sabemos.                                    │
-- │                                                                   │
-- │ Por isso cada situação sai com TRÊS números, não um:              │
-- │                                                                   │
-- │   qtd        contratos naquela situação (inclui jornada, como     │
-- │              `visitas` sempre incluiu — não mudo contagem que a   │
-- │              tela já mostra)                                      │
-- │   produtivas quantos desses o ponto podia cobrir                  │
-- │   pontos     a soma dos que ACHARAM regra — NULO se nenhum achou  │
-- │   sem_regra  quantos produtivos ficaram de fora da soma           │
-- │                                                                   │
-- │ Com os três a tela escreve "5,51 pts · 1 sem regra" em vez de um  │
-- │ total que mente por baixo.                                        │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ uma passada só, e o total continua sendo O MESMO total ─────────┐
-- │ `pontos_concluidos` e `pontos_sem_regra` PARAM de ter CTE         │
-- │ própria: saem da mesma `sit_pts`, filtrando CONCLUIDA. Dois       │
-- │ motivos:                                                          │
-- │                                                                   │
-- │ 1. Duas CTEs chamando `pontos_da_visita` por linha é o dobro de   │
-- │    chamadas da função. Com 1.300 visitas no dia isso pesa.        │
-- │ 2. Mais importante: dois caminhos para o mesmo número é dois      │
-- │    números para divergir. O cabeçalho da coluna e o segmento      │
-- │    CONCLUÍDA da barra TÊM de bater, e agora batem por             │
-- │    construção, não por coincidência.                              │
-- │                                                                   │
-- │ Conferido antes de aplicar: a soma nova de CONCLUIDA na 001 dá    │
-- │ 3,1603 — exatamente o que a tela já mostrava ("3,16 pts").        │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ LEFT JOIN LATERAL, não CROSS ───────────────────────────────────┐
-- │ `cross join lateral pontos_da_visita(v.id)` DERRUBA a visita se a │
-- │ função não devolver linha — e aí `count(*)` do `qtd` passaria a   │
-- │ contar menos contratos do que a equipe tem, em silêncio, dentro   │
-- │ de uma mudança que era "só somar pontos". Medido: hoje são 29 de  │
-- │ 29 com exatamente uma linha, então o CROSS daria o mesmo — mas a  │
-- │ contagem de situação não pode depender da função de pontuação     │
-- │ continuar se comportando. Com LEFT, visita sem linha cai em       │
-- │ `sem_regra` (`not coalesce(p.achou,false)`), que é a verdade.     │
-- └───────────────────────────────────────────────────────────────────┘
--
-- `as materialized` obrigatório: CTE com função de conjunto referenciada
-- uma vez é feita *inline*, e a função passa a rodar por linha do join
-- (traps.md, D-081).
--
-- CREATE OR REPLACE e não DROP: a ASSINATURA não muda — só o conteúdo do
-- `situacoes jsonb`. Replace preserva a ACL, então a função não renasce
-- aberta ao anon (o par 059 → 061). O revoke/grant no fim é cinto e
-- suspensório, e a conferência com `has_function_privilege` está na
-- mensagem do commit.
-- ============================================================

create or replace function public.painel_equipes(p_data date)
returns table(equipe_id uuid, codigo text, nome text, area text,
              supervisor text, supervisor_declarado boolean,
              login_toa text, tecnicos bigint, visitas bigint, ordens bigint,
              periodos jsonb, situacoes jsonb,
              ultima_atividade timestamp with time zone, situacao_final text,
              minutos_parada integer, ocioso boolean,
              ultima_baixa timestamp with time zone, ultima_baixa_origem text,
              ultimo_contrato text,
              pontos_concluidos numeric, pontos_sem_regra integer)
language sql
stable
set search_path to 'public'
as $function$
with cfg as (
  select coalesce(min(em.minutos_ocioso), 10)::int as minutos from empresa em
),
v as (
  select vi.id, vi.equipe_id, vi.situacao, vi.janela_inicio, vi.janela_fim,
         vi.contrato, vi.fim, vi.finalizado_toa, vi.tipo_atividade_id,
         coalesce(vi.fim,
                  case when vi.bloqueado_em is not null then vi.situacao_em end
         ) as encerrado_em
    from visita vi
   where vi.data_agendada = p_data
     and vi.equipe_id is not null
     and vi.excluido_em is null
),
pers as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object('janela', t.j, 'qtd', t.n) order by t.j) as lista
    from (
      select v.equipe_id,
             case when v.janela_inicio is null then 'SEM JANELA'
                  else to_char(v.janela_inicio, 'HH24:MI') || ' - ' ||
                       coalesce(to_char(v.janela_fim, 'HH24:MI'), '?')
             end as j,
             count(*) as n
        from v group by 1, 2
    ) t
   group by t.equipe_id
),
-- 077: a contagem por situacao passa a carregar a PONTUACAO junto.
-- Jornada nunca entra em produtividade -- entao ela conta em `qtd`
-- (como sempre contou) e fica FORA de `produtivas`, `pontos` e
-- `sem_regra`.
sit_pts as materialized (
  select v.equipe_id, v.situacao,
         count(*) as n,
         count(*) filter (
           where coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA')::int as produtivas,
         sum(p.pontos_claro) filter (
           where p.achou
             and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA') as pontos,
         count(*) filter (
           where not coalesce(p.achou, false)
             and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA')::int as sem_regra
    from v
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join lateral pontos_da_visita(v.id) p on true
   group by 1, 2
),
sits as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object(
           'situacao', t.situacao, 'qtd', t.n,
           'produtivas', t.produtivas, 'pontos', t.pontos, 'sem_regra', t.sem_regra
         ) order by t.n desc) as lista
    from sit_pts t
   group by t.equipe_id
),
-- 077: o total da coluna PONTOS sai da MESMA fonte do segmento
-- CONCLUIDA da barra. Dois caminhos para o mesmo numero e dois numeros
-- para divergir.
pts as (
  select s.equipe_id, s.pontos as soma, s.sem_regra
    from sit_pts s
   where s.situacao = 'CONCLUIDA'
),
oss as (
  select v.equipe_id, count(o.id) as n
    from v join ordem_servico o on o.visita_id = v.id
   group by 1
),
cont as (
  select v.equipe_id, count(*) as n from v group by 1
),
ult as (
  select distinct on (v.equipe_id) v.equipe_id, v.encerrado_em, v.situacao
    from v where v.encerrado_em is not null
   order by v.equipe_id, v.encerrado_em desc
),
-- 074: SO os eventos das visitas DESTE dia. Sem isto, `max(criado_em)`
-- devolvia o evento mais recente da equipe em qualquer dia -- na
-- pratica, a hora da importacao -- e a tela chamava aquilo de atividade.
evt as (
  select ve.equipe_id, max(ve.criado_em) as em
    from visita_evento ve
    join v on v.id = ve.visita_id
   where ve.equipe_id is not null
   group by 1
),
-- 074: a baixa da AFLINE, por O.S. A mais recente de cada equipe.
baixa_af as materialized (
  select distinct on (v.equipe_id)
         v.equipe_id, o.baixa_em as em, v.contrato
    from v join ordem_servico o on o.visita_id = v.id
   where o.baixa_em is not null
   order by v.equipe_id, o.baixa_em desc
),
-- 074: o encerramento do TOA. `finalizado_toa` e quem diz que fechou --
-- `fim` sozinho mente em atividade apenas INICIADA (D-103).
baixa_toa as materialized (
  select distinct on (v.equipe_id)
         v.equipe_id, v.fim as em, v.contrato
    from v
   where v.finalizado_toa and v.fim is not null
   order by v.equipe_id, v.fim desc
),
sup_dec as (
  select x.equipe_id, x.nome from (
    select t.equipe_id, p.nome,
           row_number() over (partition by t.equipe_id
                              order by count(*) desc, p.nome) as rn
      from tecnico t join perfil p on p.id = t.supervisor_id
     where t.situacao = 'ATIVO' and t.equipe_id is not null
     group by t.equipe_id, p.nome
  ) x where x.rn = 1
),
base as (
  select e.id, e.codigo, e.nome,
         a.apelido as area,
         coalesce(sd.nome, pe.nome, norm_supervisor(e.supervisor_nome)) as supervisor,
         (sd.nome is not null or pe.nome is not null) as supervisor_declarado,
         (select l.login_toa from equipe_login_toa l
           where l.equipe_id = e.id and l.inicio <= p_data
             and (l.fim is null or l.fim >= p_data)
           order by l.inicio desc limit 1) as login_toa,
         (select count(*) from tecnico t
           where t.equipe_id = e.id and t.situacao = 'ATIVO') as tecnicos,
         coalesce(cont.n, 0) as visitas,
         coalesce(oss.n, 0) as ordens,
         pers.lista as periodos,
         sits.lista as situacoes,
         greatest(ult.encerrado_em, evt.em) as ultima_atividade,
         ult.situacao as situacao_final,
         -- A nossa baixa tem precedencia sobre a da operadora: se
         -- alguem daqui declarou, e isso que vale.
         coalesce(baf.em, btoa.em) as ultima_baixa,
         case when baf.em is not null then 'AFLINE'
              when btoa.em is not null then 'TOA' end as ultima_baixa_origem,
         coalesce(baf.contrato, btoa.contrato) as ultimo_contrato,
         pts.soma as pontos_concluidos,
         coalesce(pts.sem_regra, 0) as pontos_sem_regra
    from equipe e
    left join area_trabalho a on a.id = e.area_id
    left join sup_dec sd on sd.equipe_id = e.id
    left join perfil  pe on pe.id = e.supervisor_id
    left join cont on cont.equipe_id = e.id
    left join oss  on oss.equipe_id  = e.id
    left join pers on pers.equipe_id = e.id
    left join sits on sits.equipe_id = e.id
    left join ult  on ult.equipe_id  = e.id
    left join evt  on evt.equipe_id  = e.id
    left join baixa_af  baf  on baf.equipe_id  = e.id
    left join baixa_toa btoa on btoa.equipe_id = e.id
    left join pts on pts.equipe_id = e.id
)
select b.id, b.codigo, b.nome, b.area, b.supervisor, b.supervisor_declarado,
       b.login_toa, b.tecnicos, b.visitas, b.ordens, b.periodos, b.situacoes,
       b.ultima_atividade, b.situacao_final,
       case when p_data = current_date and b.ultima_atividade is not null
            then floor(extract(epoch from now() - b.ultima_atividade) / 60)::int
       end,
       case when p_data = current_date
            then b.situacao_final in ('CONCLUIDA', 'CANCELADA')
                 and b.ultima_atividade is not null
                 and now() - b.ultima_atividade > ((select c.minutos from cfg c) || ' minutes')::interval
       end,
       b.ultima_baixa, b.ultima_baixa_origem, b.ultimo_contrato,
       b.pontos_concluidos, b.pontos_sem_regra
  from base b;
$function$;

revoke all on function public.painel_equipes(date) from public, anon;
grant execute on function public.painel_equipes(date) to authenticated;

notify pgrst, 'reload schema';
