-- ============================================================
-- 079 · A jornada aparece — e não conta como contrato
--
-- > "ele vai tá ali pra gente saber mais ou menos o que ele tá fazendo
-- >  quando não está no contrato, e os status devem subir tanto na
-- >  visão da equipe como na rota do dia [...] mais não serve para
-- >  considerar como um contrato ou contar na produtividade"
-- >                                                — Emanuel, 15/09
--
-- ┌─ o estrago que a 078 criou, e que esta conserta ──────────────────┐
-- │ Enquanto a jornada não tinha equipe, ela não aparecia em lugar     │
-- │ nenhum — e por tabela não sujava conta nenhuma. A 078 deu dono a   │
-- │ ela, e aí o painel passou a contá-la como contrato: a equipe 001   │
-- │ saltou de 11 para 13 "Contratos", e nasceu uma situação fantasma   │
-- │ `EM_EXECUCAO` com `qtd: 2, produtivas: 0` — que é a Refeição e o   │
-- │ Na Base posando de serviço em andamento.                          │
-- │                                                                    │
-- │ Dar visibilidade e dar PESO são coisas diferentes. Esta migration  │
-- │ separa as duas: jornada sai de TODA contagem e ganha um campo só   │
-- │ dela.                                                              │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ o que sai da conta, item por item ───────────────────────────────┐
-- │ `visitas`   a coluna se chama CONTRATOS; jornada não é contrato    │
-- │ `ordens`    jornada não tem O.S. — contava zero, mas por acidente  │
-- │ `situacoes` a barra de composição e os pontos por segmento         │
-- │ `periodos`  a régua de capacidade do turno: uma Refeição ocupando  │
-- │             uma vaga de instalação diria que o turno está cheio    │
-- │ `ultima_baixa` / `situacao_final` / `evt` / OCIOSO                 │
-- │             "a equipe parou" é sobre CONTRATO. Se a última coisa   │
-- │             do dia foi o almoço, o painel diria que o dia fechou   │
-- │             às 14:26 — e não fechou, o técnico foi para a próxima  │
-- │             instalação.                                            │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ e onde ela APARECE ──────────────────────────────────────────────┐
-- │ `jornada jsonb`: uma lista por equipe, em ordem de hora, com tipo, │
-- │ início, fim e duração. É o "o que ele estava fazendo quando não    │
-- │ estava no contrato" que o Emanuel pediu, e fica ao lado da régua   │
-- │ de períodos — não dentro dela.                                     │
-- │                                                                    │
-- │ Na ROTA, a jornada entra na sequência do técnico (senão o          │
-- │ controlador vê um buraco de duas horas sem explicação), mas com    │
-- │ `ordem` NULA e sem km: numerá-la faria "a 7ª parada do dia" ser o  │
-- │ almoço, e medir deslocamento até um ponto sem coordenada           │
-- │ inventaria distância. `natureza` diz qual é qual.                  │
-- └───────────────────────────────────────────────────────────────────┘
--
-- DROP e não REPLACE nas duas: coluna nova no `returns table` dá
-- "cannot change return type". E função recriada do zero NASCE COM A
-- ACL ABERTA ao anon — por isso o revoke/grant no fim não é decoração
-- (o par 059 → 061).
-- ============================================================

-- ------------------------------------------------------------------
-- A. O painel da equipe
-- ------------------------------------------------------------------
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
              jornada jsonb)
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
         coalesce(ta.natureza, 'PRODUTIVA') as natureza,
         ta.nome as tipo_nome,
         coalesce(vi.fim,
                  case when vi.bloqueado_em is not null then vi.situacao_em end
         ) as encerrado_em
    from visita vi
    left join tipo_atividade ta on ta.id = vi.tipo_atividade_id
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
         jor.lista as jornada
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
       b.pontos_concluidos, b.pontos_sem_regra, b.jornada
  from base b;
$function$;

revoke all on function public.painel_equipes(date) from public, anon;
grant execute on function public.painel_equipes(date) to authenticated;


-- ------------------------------------------------------------------
-- B. A rota do dia
-- ------------------------------------------------------------------
drop function if exists public.rota_do_dia(date);

create function public.rota_do_dia(p_data date)
returns table(visita_id uuid, contrato text, login text, tecnico text,
              equipe text, equipe_id uuid, bairro text, area text,
              lat numeric, lng numeric,
              inicio timestamp with time zone, fim timestamp with time zone,
              finalizado_toa boolean,
              janela_inicio time without time zone, janela_fim time without time zone,
              situacao text, tipo_servico text, tec1 text, ordem integer,
              km_desde_anterior double precision, voltou_ao_bairro boolean,
              baixa_codigos text, baixa_origem text, baixa_detalhe text,
              natureza text, tipo_atividade text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with v as (
    select vi.id, vi.contrato,
           -- 079: a jornada vem do TOA SEM login. `login_do_recurso` le
           -- o de/para que a propria fonte emitiu (078) -- sem ele estas
           -- linhas caem fora do `where login is not null` logo abaixo e
           -- a rota mostra um buraco de duas horas sem explicacao.
           coalesce(
             nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),''),
             login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso')
           ) as login,
           nullif(btrim(coalesce(vi.dados_origem->>'Recurso','')),'')          as recurso,
           e.codigo as equipe, vi.equipe_id, vi.bairro, a.apelido as area,
           vi.lat, vi.lng, vi.inicio, vi.fim, vi.finalizado_toa,
           vi.janela_inicio, vi.janela_fim, vi.situacao, ts.nome as tipo_servico,
           vi.tec1::text as tec1,
           coalesce(ta.natureza, 'PRODUTIVA') as natureza,
           ta.nome as tipo_atividade
      from visita vi
      left join equipe e on e.id = vi.equipe_id
      left join area_trabalho a on a.id = vi.area_id
      left join tipo_servico ts on ts.id = vi.tipo_servico_id
      left join tipo_atividade ta on ta.id = vi.tipo_atividade_id
     where vi.excluido_em is null
       and vi.data_agendada = p_data
       and vi.empresa_id = minha_empresa()
       and vi.base_id in (select bases_visiveis())
       and (eh_gestor() or vi.equipe_id in (select equipes_visiveis()))
  ),
  -- A NUMERACAO e so de contrato: "a 7a parada do dia" nao pode ser o
  -- almoco. Jornada entra na lista com `ordem` nula.
  ord as (
    select v.*,
           case when v.natureza <> 'JORNADA'
                then row_number() over (
                       partition by v.login, (v.natureza <> 'JORNADA')
                       order by v.inicio nulls last, v.id)
           end as ordem
      from v where v.login is not null
  ),
  baixas as materialized (
    select o.visita_id,
           string_agg(distinct cba.codigo::text, ' · ') as af_cods,
           string_agg(distinct cbt.codigo::text, ' · ') as toa_cods,
           string_agg(distinct ('AFLINE ' || cba.codigo || ' · ' || cba.descricao),
                      chr(10)) as af_det,
           string_agg(distinct ('TOA ' || cbt.codigo || ' · ' || cbt.descricao),
                      chr(10)) as toa_det
      from ordem_servico o
      left join codigo_baixa cba on cba.id = o.codigo_baixa_afline_id
      left join codigo_baixa cbt on cbt.id = o.codigo_baixa_id
     where o.visita_id in (select id from ord)
     group by o.visita_id
  )
  select o.id, o.contrato, o.login, o.recurso, o.equipe, o.equipe_id,
         o.bairro, o.area, o.lat, o.lng, o.inicio, o.fim, o.finalizado_toa,
         o.janela_inicio, o.janela_fim,
         o.situacao, o.tipo_servico, o.tec1, o.ordem::int,
         -- km e "voltou ao bairro" so entre CONTRATOS: jornada nao tem
         -- coordenada, e medir deslocamento ate um ponto sem coordenada
         -- inventaria distancia.
         case when o.natureza <> 'JORNADA'
              then km_entre(ant.lat::float8, ant.lng::float8,
                            o.lat::float8, o.lng::float8) end,
         case when o.natureza <> 'JORNADA' then exists (
           select 1 from ord x
            where x.login = o.login and x.ordem < o.ordem - 1
              and x.natureza <> 'JORNADA'
              and norm_txt(x.bairro) = norm_txt(o.bairro)
              and o.bairro is not null) end,
         coalesce(b.af_cods, b.toa_cods),
         case when b.af_cods is not null then 'AFLINE'
              when b.toa_cods is not null then 'TOA' end,
         nullif(concat_ws(chr(10), b.af_det, b.toa_det), ''),
         o.natureza, o.tipo_atividade
    from ord o
    left join ord ant on ant.login = o.login and ant.ordem = o.ordem - 1
                     and ant.natureza <> 'JORNADA'
    left join baixas b on b.visita_id = o.id
   order by o.login, o.inicio nulls last, o.ordem;
$function$;

revoke all on function public.rota_do_dia(date) from public, anon;
grant execute on function public.rota_do_dia(date) to authenticated;

notify pgrst, 'reload schema';
