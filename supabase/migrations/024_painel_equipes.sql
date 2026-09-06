-- 024 · Painel de equipes por dia, com períodos, situações e OCIOSO (D-026)
--
-- Por que uma função e não a view `vw_equipe_resumo`:
--
--   A view usa CURRENT_DATE. Com dado de 04 e 05/09 e o relógio em 06/09,
--   ela devolve zero para tudo — a tela parecia vazia sem estar errada.
--   O sistema atual tem "DATA DA SITUAÇÃO" no topo; aqui a data é
--   parâmetro, e a tela escolhe.
--
-- OCIOSO (D-026): 10 minutos após encerrar o contrato anterior sem novo
-- status. O parâmetro é `empresa.minutos_ocioso`, não número no código.
--
--   ┌─ D-033 ────────────────────────────────────────────────────────┐
--   │ A regra pede o ÚLTIMO EVENTO POR EQUIPE. Hoje `visita_evento`  │
--   │ só tem IMPORTADA e CONFLITO_TOA, e com `equipe_id` nulo — o    │
--   │ campo ainda não registrou nada por aqui.                       │
--   │                                                                 │
--   │ Então a última atividade sai do maior entre:                   │
--   │   · `visita.fim` — o encerramento real, vindo do TOA           │
--   │   · `visita.situacao_em`, MAS SÓ quando `bloqueado_em` existe, │
--   │     isto é, quando o campo tocou na visita (D-006)             │
--   │   · `visita_evento.criado_em` da equipe — quando existir       │
--   │                                                                 │
--   │ `situacao_em` puro NÃO serve: numa visita cancelada ele é a    │
--   │ hora da IMPORTAÇÃO. Usá-lo dava 06/09 03:34 para meia          │
--   │ operação — a mesma armadilha do `criado_em` no CLAUDE.md.      │
--   │ Assim a métrica funciona hoje e melhora sozinha quando o app   │
--   │ de campo começar a gravar evento.                              │
--   │                                                                 │
--   │ E `ocioso` só é calculado para o DIA CORRENTE. Ocioso é estado │
--   │ de agora; para um dia passado a resposta seria "todo mundo     │
--   │ ocioso há dois dias", que não informa nada. Em dia passado a   │
--   │ tela mostra a hora da última atividade.                        │
--   └─────────────────────────────────────────────────────────────────┘

create or replace function painel_equipes(p_data date)
returns table (
  equipe_id        uuid,
  codigo           text,
  nome             text,
  area             text,
  supervisor       text,
  login_toa        text,
  tecnicos         bigint,
  visitas          bigint,
  ordens           bigint,
  periodos         jsonb,
  situacoes        jsonb,
  ultima_atividade timestamptz,
  situacao_final   text,
  minutos_parada   integer,
  ocioso           boolean
)
language sql stable set search_path = public as $fn$
with cfg as (
  select coalesce(min(em.minutos_ocioso), 10)::int as minutos from empresa em
),
v as (
  select vi.id, vi.equipe_id, vi.situacao, vi.janela_inicio, vi.janela_fim,
         coalesce(vi.fim,
                  case when vi.bloqueado_em is not null then vi.situacao_em end
         ) as encerrado_em
    from visita vi
   where vi.data_agendada = p_data
     and vi.equipe_id is not null
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
evt as (
  select ve.equipe_id, max(ve.criado_em) as em
    from visita_evento ve where ve.equipe_id is not null group by 1
),
base as (
  select e.id, e.codigo, e.nome,
         a.apelido as area,
         norm_supervisor(e.supervisor_nome) as supervisor,
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
         ult.situacao as situacao_final
    from equipe e
    left join area_trabalho a on a.id = e.area_id
    left join cont on cont.equipe_id = e.id
    left join oss  on oss.equipe_id  = e.id
    left join pers on pers.equipe_id = e.id
    left join sits on sits.equipe_id = e.id
    left join ult  on ult.equipe_id  = e.id
    left join evt  on evt.equipe_id  = e.id
)
select b.id, b.codigo, b.nome, b.area, b.supervisor, b.login_toa,
       b.tecnicos, b.visitas, b.ordens, b.periodos, b.situacoes,
       b.ultima_atividade, b.situacao_final,
       case when p_data = current_date and b.ultima_atividade is not null
            then floor(extract(epoch from now() - b.ultima_atividade) / 60)::int
       end,
       case when p_data = current_date
            then b.situacao_final in ('CONCLUIDA', 'CANCELADA')
                 and b.ultima_atividade is not null
                 and now() - b.ultima_atividade > ((select c.minutos from cfg c) || ' minutes')::interval
       end
  from base b;
$fn$;

revoke all on function painel_equipes(date) from public, anon;
grant execute on function painel_equipes(date) to authenticated;
