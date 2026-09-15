-- ============================================================
-- 083 - A regua sabe o tipo do servico, e a equipe mostra os tempos
--
-- > "se for uma rota inteira de Visita tecnica a capacidade e: 08 as 11
-- >  - 3, 11 as 14 - 2, 14 as 17 - 3" - "janela de 08 as 22 horas nao
-- >  devem entrar nessa caixinha azul" - "colocar mais informacoes da
-- >  equipe, como tempo medio de deslocamento, tempo medio de execucao"
-- >                                                 -- Emanuel, 15/09
--
-- Tres coisas, todas dados que a tela nao tinha:
--
-- 1. `periodos[].vt` -- quantas daquela janela sao VISITA TECNICA. A
--    capacidade do turno depende do tipo: VT e mais rapida que
--    instalacao. Sem esta contagem a regua compara TODA janela contra a
--    tabela de instalacao, e pinta de vermelho uma rota de VT que esta
--    perfeitamente dentro do que cabe.
--
-- 2. `min_deslocamento` e `min_execucao` -- os dois tempos medios do
--    dia, em minutos. Deslocamento e a coluna que o TOA manda; execucao
--    e fim menos inicio.
--
--    Guarda de sanidade nas duas: negativo ou acima de 24h fica FORA da
--    media. Um contrato com hora invertida envenena a media inteira, e
--    media envenenada e pior que media nenhuma -- ela parece um numero.
--    NULO quando nao ha nenhuma medida: zero afirmaria que a equipe nao
--    gastou tempo (D-117).
--
-- 3. A janela LARGA sai do desenho -- isso e na tela, nao aqui, mas o
--    dado tem de chegar para ela poder decidir. Ver D-151.
--
-- Nada disso muda contagem existente: `visitas`, `ordens`, `situacoes` e
-- a nota TEC1 continuam iguais.
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
              pontos_concluidos numeric, pontos_sem_regra integer,
              jornada jsonb, tec1 jsonb,
              min_deslocamento integer, min_execucao integer)
language sql
stable
set search_path to 'public'
as $function$
with cfg as (
  select coalesce(min(em.minutos_ocioso), 10)::int as minutos from empresa em
),
-- TODAS as atividades do dia, com a natureza ao lado.
tudo as (
  select vi.id, vi.equipe_id, vi.situacao, vi.janela_inicio, vi.janela_fim,
         vi.contrato, vi.fim, vi.inicio, vi.finalizado_toa, vi.tipo_atividade_id,
         vi.tempo_deslocamento,
         coalesce(ta.natureza, 'PRODUTIVA') as natureza,
         ta.nome as tipo_nome,
         ts.nome as grupo_nome,
         coalesce(vi.fim,
                  case when vi.bloqueado_em is not null then vi.situacao_em end
         ) as encerrado_em
    from visita vi
    left join tipo_atividade ta on ta.id = vi.tipo_atividade_id
    left join tipo_servico  ts on ts.id = vi.tipo_servico_id
   where vi.data_agendada = p_data
     and vi.equipe_id is not null
     and vi.excluido_em is null
),
-- 079: daqui para baixo, CONTRATO e jornada andam separados. `v` continua
-- sendo o nome do conjunto que alimenta toda contagem -- e agora ele
-- nao tem jornada dentro.
v as (
  select * from tudo where natureza <> 'JORNADA'
),
jor as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object(
           'tipo', t.tipo_nome,
           'situacao', t.situacao,
           'inicio', t.inicio,
           'fim', t.fim,
           'minutos', case when t.inicio is not null and t.fim is not null
                           then floor(extract(epoch from t.fim - t.inicio) / 60)::int
                      end
         ) order by t.inicio nulls last) as lista
    from tudo t
   where t.natureza = 'JORNADA'
   group by t.equipe_id
),
-- 081: a nota TEC1, sobre O.S. Denominador = padrao + sem_padrao.
-- Expurgo e "sem regra" ficam FORA: soma-los como acerto inflaria a nota,
-- e como erro puniria quem nao errou.
-- 082: AO VIVO, nao da coluna guardada. O cabecalho da equipe lia o
-- cache e a linha do contrato lia `visita.tec1`, que o importador refaz
-- linha a linha: duas fontes para o mesmo fato, e a tela se contradizia
-- sozinha. Medido como `authenticated`: `tec1_da_os` sobre TODAS as O.S.
-- do dia custa 4,8 ms, contra 340 ms do painel inteiro. O cache nao
-- comprava nada -- e a 080 pos a carencia em CADASTRO justamente para
-- poder mudar, entao cachear o resultado era convite a mentir calado.
tec as materialized (
  select v.equipe_id,
         count(*) filter (where t.tec1 = 'PADRAO')     as padrao,
         count(*) filter (where t.tec1 = 'SEM_PADRAO') as sem_padrao,
         count(*) filter (where t.tec1 = 'EXPURGADA')  as expurgada,
         count(*) filter (where t.tec1 is null)        as sem_regra
    from v
    join ordem_servico o on o.visita_id = v.id
    cross join lateral (select tec1_da_os(o.id) as tec1) t
   group by 1
),
-- 083: a janela leva junto quantas dela sao VISITA TECNICA.
-- A capacidade do turno muda com o tipo de servico -- VT e mais rapida --
-- e sem esta contagem a regua compara toda janela contra a tabela de
-- instalacao. Ver D-151.
pers as (
  select t.equipe_id,
         jsonb_agg(jsonb_build_object(
           'janela', t.j, 'qtd', t.n, 'vt', t.vt) order by t.j) as lista
    from (
      select v.equipe_id,
             case when v.janela_inicio is null then 'SEM JANELA'
                  else to_char(v.janela_inicio, 'HH24:MI') || ' - ' ||
                       coalesce(to_char(v.janela_fim, 'HH24:MI'), '?')
             end as j,
             count(*) as n,
             count(*) filter (
               where norm_txt(coalesce(v.grupo_nome, '')) = 'VISITA TECNICA')::int as vt
        from v group by 1, 2
    ) t
   group by t.equipe_id
),
-- 083: os dois tempos medios do dia, em minutos.
-- > "colocar mais informacoes da equipe, como tempo medio de
-- >  deslocamento, tempo medio de execucao" -- Emanuel, 15/09
--
-- DESLOCAMENTO e a coluna que o TOA manda (`Tempo de Deslocamento`);
-- EXECUCAO e fim menos inicio. As duas com guarda de sanidade: negativo
-- ou acima de 24h e dado sujo, e media envenenada por um outlier e pior
-- que media nenhuma. NULO quando nao ha nenhuma medida -- zero afirmaria
-- que a equipe nao gastou tempo (D-117).
tempos as (
  select v.equipe_id,
         round(avg(extract(epoch from v.tempo_deslocamento) / 60)
               filter (where v.tempo_deslocamento is not null
                         and extract(epoch from v.tempo_deslocamento)
                             between 0 and 86400))::int as desloc,
         round(avg(extract(epoch from (v.fim - v.inicio)) / 60)
               filter (where v.inicio is not null and v.fim is not null
                         and v.fim > v.inicio
                         and v.fim - v.inicio < interval '24 hours'))::int as exec
    from v group by 1
),
sit_pts as materialized (
  select v.equipe_id, v.situacao,
         count(*) as n,
         count(*) filter (where v.natureza = 'PRODUTIVA')::int as produtivas,
         sum(p.pontos_claro) filter (
           where p.achou and v.natureza = 'PRODUTIVA') as pontos,
         count(*) filter (
           where not coalesce(p.achou, false)
             and v.natureza = 'PRODUTIVA')::int as sem_regra
    from v
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
evt as (
  select ve.equipe_id, max(ve.criado_em) as em
    from visita_evento ve
    join v on v.id = ve.visita_id
   where ve.equipe_id is not null
   group by 1
),
baixa_af as materialized (
  select distinct on (v.equipe_id)
         v.equipe_id, o.baixa_em as em, v.contrato
    from v join ordem_servico o on o.visita_id = v.id
   where o.baixa_em is not null
   order by v.equipe_id, o.baixa_em desc
),
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
         coalesce(baf.em, btoa.em) as ultima_baixa,
         case when baf.em is not null then 'AFLINE'
              when btoa.em is not null then 'TOA' end as ultima_baixa_origem,
         coalesce(baf.contrato, btoa.contrato) as ultimo_contrato,
         pts.soma as pontos_concluidos,
         coalesce(pts.sem_regra, 0) as pontos_sem_regra,
         jor.lista as jornada,
         -- `pct` NULO quando o denominador e zero: equipe sem O.S.
         -- avaliavel nao tem nota 0%, tem nota desconhecida (D-117).
         case when tec.equipe_id is null then null else jsonb_build_object(
           'padrao', tec.padrao, 'sem_padrao', tec.sem_padrao,
           'expurgada', tec.expurgada, 'sem_regra', tec.sem_regra,
           'pct', case when (tec.padrao + tec.sem_padrao) > 0
                       then round(100.0 * tec.padrao / (tec.padrao + tec.sem_padrao), 1)
                  end) end as tec1,
         tp.desloc as min_deslocamento,
         tp.exec   as min_execucao
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
    left join jor on jor.equipe_id = e.id
    left join tec on tec.equipe_id = e.id
    left join tempos tp on tp.equipe_id = e.id
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
       b.pontos_concluidos, b.pontos_sem_regra, b.jornada, b.tec1,
       b.min_deslocamento, b.min_execucao
  from base b;
$function$;

revoke all on function public.painel_equipes(date) from public, anon;
grant execute on function public.painel_equipes(date) to authenticated;

notify pgrst, 'reload schema';
