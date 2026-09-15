-- ============================================================
-- 074 · A equipe diz QUANDO baixou e QUANTO fez
--
-- > "precisamos encher um pouco mais de informação por exemplo: último
-- >  horário baixado do último contrato, e preciso saber quantos pontos
-- >  ele fez concluído hoje" — Emanuel, 14/09
--
-- ┌─ o defeito que apareceu no caminho ──────────────────────────────┐
-- │ A coluna ESTADO mostrava 20:47 para as TRÊS equipes do dia. Não   │
-- │ era coincidência: `ultima_atividade` é                            │
-- │                                                                   │
-- │     greatest(ult.encerrado_em, evt.em)                            │
-- │                                                                   │
-- │ e a CTE `evt` era `max(criado_em) from visita_evento where        │
-- │ equipe_id is not null group by equipe_id` — SEM FILTRO DE DIA.    │
-- │ Ou seja: o evento mais recente da equipe em QUALQUER dia, que na   │
-- │ prática é a hora em que a planilha foi importada. A tela dizia    │
-- │ "a equipe parou às 20:47" quando ninguém tinha parado às 20:47.    │
-- │                                                                   │
-- │ `evt` passa a ser restrita às visitas DAQUELE dia.                 │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ "último horário baixado" tem DUAS fontes, e elas divergem ──────┐
-- │ São duas baixas (business-rules.md): a da operadora, que vem do   │
-- │ TOA, e a nossa. Então a coluna nova vem com a PROCEDÊNCIA junto:  │
-- │                                                                   │
-- │   AFLINE  max(ordem_servico.baixa_em) — alguém baixou aqui        │
-- │   TOA     visita.fim, e SÓ com `finalizado_toa` (D-103:           │
-- │           `fim` vem preenchido em atividade apenas INICIADA, e    │
-- │           sem esse filtro a tela diz que fechou quem não fechou)  │
-- │                                                                   │
-- │ Hoje, nesta base: 83 O.S., ZERO com `baixa_em`. Tudo que existe   │
-- │ veio de importação. Então o que vai aparecer na tela é TOA — e a  │
-- │ etiqueta ao lado do horário é o que impede alguém de ler isso     │
-- │ como "a AFLINE baixou".                                           │
-- │                                                                   │
-- │ Vem junto o CONTRATO daquela baixa: "o último horário baixado do  │
-- │ ÚLTIMO CONTRATO" é uma pergunta sobre um contrato específico, e   │
-- │ um horário solto não deixa ninguém ir conferir.                   │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ pontos: e as que não têm regra ─────────────────────────────────┐
-- │ `pontos_concluidos` soma `pontos_claro` das CONCLUÍDAS do dia —   │
-- │ o mesmo número que `produtividade_periodo` soma (057), para a     │
-- │ tela não ter dois totais diferentes da mesma coisa.               │
-- │                                                                   │
-- │ Mas em 09/09, 125 das 364 visitas não achavam regra. Somar essas  │
-- │ como zero é AFIRMAR que o serviço não vale nada (D-117). Então    │
-- │ vai junto `pontos_sem_regra`: quantas concluídas ficaram de fora  │
-- │ da soma. A tela escreve as duas coisas.                           │
-- │                                                                   │
-- │ JORNADA fora: `Na Base` e `Refeição` foram 103 de 344 num dia, e  │
-- │ jornada não entra em produtividade. Só o `pts` filtra — `visitas` │
-- │ e `ordens` continuam contando tudo, como sempre contaram.         │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ por que DROP e não CREATE OR REPLACE ───────────────────────────┐
-- │ Coluna nova no `returns table` ⇒ "cannot change return type". E   │
-- │ função recriada do zero NASCE COM A ACL ABERTA ao anon — por isso │
-- │ o revoke/grant no fim não é decoração (par 059 → 061).            │
-- └───────────────────────────────────────────────────────────────────┘
--
-- A função continua INVOKER de propósito: `pontos_da_visita` e as
-- contagens têm de ver o que QUEM PERGUNTA vê. Medido como
-- `authenticated`, nunca como dono (D-081) — número na mensagem do
-- commit.
-- ============================================================

drop function if exists public.painel_equipes(date);

create function public.painel_equipes(p_data date)
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
sits as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object('situacao', t.situacao, 'qtd', t.n) order by t.n desc) as lista
    from (select v.equipe_id, v.situacao, count(*) as n from v group by 1, 2) t
   group by t.equipe_id
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
-- 074: SÓ os eventos das visitas DESTE dia. Sem isto, `max(criado_em)`
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
-- 074: pontuacao das CONCLUIDAS do dia, sem jornada.
-- `as materialized` obrigatorio: CTE com funcao de conjunto referenciada
-- uma vez e feita *inline*, e a funcao passa a rodar por linha do join
-- (traps.md, D-081).
pts as materialized (
  select c.equipe_id,
         sum(p.pontos_claro) filter (where p.achou) as soma,
         count(*) filter (where not p.achou)::int as sem_regra
    from (
      select v.id, v.equipe_id
        from v
        left join tipo_atividade ta on ta.id = v.tipo_atividade_id
       where v.situacao = 'CONCLUIDA'
         and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA'
    ) c
    cross join lateral pontos_da_visita(c.id) p
   group by c.equipe_id
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
