-- ============================================================
-- 084 - A desconexao sai das contas da equipe e da regua
--
-- > "nao vamos considerar desconexao nesses dados da equipe, nem no
-- >  grafico do periodo ok, vamos expurgar a desconexao dessas colunas
-- >  do menu equipe, na coluna equipe tirar da statistica de
-- >  informacoes que temos, e no periodo tambem o resto deixa"
-- >                                                 -- Emanuel, 23/09
--
-- O QUE SAI da desconexao (grupo de servico DESCONEXAO):
--   * PONTOS concluidos e o "+N sem regra" do cartao da equipe
--   * a nota TEC1 do cartao
--   * os TEMPOS medios (deslocamento e execucao)
--   * os PERIODOS -- a regua de capacidade do turno
--
-- O QUE FICA como estava ("o resto deixa"):
--   * CONTRATOS, O.S. e a coluna SITUACAO -- contam o dia inteiro
--   * BAIXOU e ULTIMO STATUS -- sao fatos do dia, nao estatistica: a
--     hora do ultimo encerramento. Tirar a desconexao so do cartao
--     faria o BAIXOU dizer uma hora e a coluna ULTIMO STATUS outra,
--     na mesma linha.
--
-- `desconexoes` volta junto: quantos contratos ficaram fora das contas.
-- Sem ele a tela nao teria como dizer que expurgou -- e numero que
-- encolhe calado parece defeito.
--
-- A deteccao e pelo NOME do grupo, por `norm_txt`, como a 083 ja faz
-- com VISITA TECNICA. Contrato sem grupo NAO e desconexao: fica dentro.
--
-- E UM DEFEITO ANTIGO, corrigido junto: OCIOSO media "hoje" com
-- `current_date`, que e UTC. Em Manaus o dia vira as 20h -- dali ate a
-- meia-noite local, `p_data = current_date` era FALSO para o dia de
-- hoje, e a tela parava de marcar equipe ociosa (e de contar minutos
-- parada) justamente no fim do turno. Agora `hoje_local()`, como manda
-- `agent_docs/traps.md`.
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
              min_deslocamento integer, min_execucao integer,
              desconexoes integer)
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
         norm_txt(coalesce(ts.nome, '')) = 'DESCONEXAO' as desconexao,
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
-- 084: `v` sem a desconexao. Alimenta so o que e ESTATISTICA da equipe
-- (pontos, TEC1, tempos) e a regua de periodos. Contagem, situacao e
-- ultima baixa continuam em `v`.
vs as (
  select * from v where not desconexao
),
desc_n as (
  select v.equipe_id, count(*)::int as n from v where v.desconexao group by 1
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
    from vs v
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
        from vs v group by 1, 2
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
    from vs v group by 1
),
sit_pts as materialized (
  select v.equipe_id, v.situacao,
         count(*) as n,
         count(*) filter (where v.natureza = 'PRODUTIVA')::int as produtivas,
         sum(p.pontos_claro) filter (
           where p.achou and v.natureza = 'PRODUTIVA') as pontos,
         count(*) filter (
           where not coalesce(p.achou, false)
             and v.natureza = 'PRODUTIVA')::int as sem_regra,
         -- 084: as mesmas duas contas, sem desconexao -- so o cartao usa.
         sum(p.pontos_claro) filter (
           where p.achou and v.natureza = 'PRODUTIVA'
             and not v.desconexao) as pontos_eq,
         count(*) filter (
           where not coalesce(p.achou, false)
             and v.natureza = 'PRODUTIVA'
             and not v.desconexao)::int as sem_regra_eq
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
  select s.equipe_id, s.pontos_eq as soma, s.sem_regra_eq as sem_regra
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
         tp.exec   as min_execucao,
         coalesce(dn.n, 0) as desconexoes
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
    left join desc_n dn on dn.equipe_id = e.id
)
select b.id, b.codigo, b.nome, b.area, b.supervisor, b.supervisor_declarado,
       b.login_toa, b.tecnicos, b.visitas, b.ordens, b.periodos, b.situacoes,
       b.ultima_atividade, b.situacao_final,
       case when p_data = hoje_local() and b.ultima_atividade is not null
            then floor(extract(epoch from now() - b.ultima_atividade) / 60)::int
       end,
       case when p_data = hoje_local()
            then b.situacao_final in ('CONCLUIDA', 'CANCELADA')
                 and b.ultima_atividade is not null
                 and now() - b.ultima_atividade > ((select c.minutos from cfg c) || ' minutes')::interval
       end,
       b.ultima_baixa, b.ultima_baixa_origem, b.ultimo_contrato,
       b.pontos_concluidos, b.pontos_sem_regra, b.jornada, b.tec1,
       b.min_deslocamento, b.min_execucao, b.desconexoes
  from base b;
$function$;

revoke all on function public.painel_equipes(date) from public, anon;
grant execute on function public.painel_equipes(date) to authenticated;

notify pgrst, 'reload schema';
