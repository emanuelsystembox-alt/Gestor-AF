-- ============================================================
-- 082 - O TEC1 do painel sai do cache, e a reconciliacao acha a visita
--
-- DEFEITO MEU, introduzido na 080. O Emanuel viu primeiro:
--
-- > "por que mostra 4 os? se tem mais que isso? tem 6 o.s so nessa tela,
-- >  tem que ver essa contagem" -- Emanuel, 15/09
--
-- E havia coisa pior na MESMA tela: o contrato 1010746 escrito
-- "TEC1 SEM PADRAO" na linha, enquanto o cabecalho da equipe dizia 100%.
-- A tela se contradizia sozinha.
--
-- CAUSA 1 - filtro errado na reconciliacao.
--   `reconciliar_importacao` atualizava `ordem_servico.tec1` filtrando
--   por `visita.importacao_id = p_importacao_id`. Mas o importador so
--   carimba `importacao_id` no INSERT: visita que ja existia e foi
--   ATUALIZADA mantem o id da importacao que a CRIOU.
--
--   Medido: a importacao das 18:31 trouxe 30 linhas e carimbou UMA
--   visita. O refresh pegou 1 de 30; as outras 29 ficaram com a coluna
--   NULA -- e 4 O.S. da equipe 002 sumiram do denominador, inclusive a
--   unica SEM PADRAO. Dai o "4/4 - 100%" numa equipe com 8 O.S.
--
--   `importacao_linha.visita_id` e o conjunto exato do que a importacao
--   tocou, e vem preenchido (30 de 30).
--
-- CAUSA 2, mais grave - duas fontes para o mesmo fato.
--   O painel lia `ordem_servico.tec1` (cache) e a linha do contrato lia
--   `visita.tec1`, que o importador refaz linha a linha. Com uma das
--   duas desatualizada, a tela se contradiz.
--
--   Pior: a 080 tirou a carencia do codigo e pos em CADASTRO justamente
--   para poder mudar. Cachear o resultado de uma regra que muda e
--   convite a mentir em silencio -- no dia em que alguem trocar 119 por
--   90, todo valor guardado fica errado sem aviso.
--
--   MEDIDO como `authenticated` (nunca como dono -- D-081):
--     painel_equipes inteiro ......................... 340 ms
--     tec1_da_os ao vivo, TODAS as O.S. do dia ....... 4,8 ms
--   O cache nao estava comprando nada. Agora o cabecalho e a linha leem
--   a MESMA regra no MESMO instante.
--
-- `ordem_servico.tec1` CONTINUA existindo, para relatorio e filtro nao
-- terem de chamar funcao por linha. Mas deixa de ser o que o painel le:
-- quem manda e `tec1_da_os()`; a coluna e conveniencia que a importacao
-- e `recalcular_tec1()` mantem.
--
-- CONFERIDO depois de aplicar, em todo o banco: 0 de 119 O.S. e 0 de 108
-- visitas com o valor guardado diferente da regra ao vivo, e 0 contratos
-- SEM PADRAO dentro de equipe marcando 100%.
-- ============================================================

create or replace function public.reconciliar_importacao(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base    uuid;
  v_empresa uuid;
  n_recurso int := 0;
  n_tipo    int := 0;
  n_ligado  int := 0;
  n_jornada int := 0;
  n_tec1    int := 0;
begin
  select i.base_id into v_base from importacao i where i.id = p_importacao_id;
  if v_base is null then
    return jsonb_build_object('erro', 'importacao sem base');
  end if;
  select b.empresa_id into v_empresa from base b where b.id = v_base;

  with candidatos as (
    select nullif(btrim(l.dados->>'ID do Recurso'), '')     as recurso,
           nullif(btrim(l.dados->>'Login do Técnico'), '')  as login,
           coalesce(j_data(l.dados, 'Data'), current_date)  as dia
      from importacao_linha l
     where l.importacao_id = p_importacao_id
  ),
  validos as (
    select recurso, login, min(dia) as de, max(dia) as ate, count(*) as qtd
      from candidatos
     where recurso is not null and login is not null
     group by 1, 2
  ),
  vencedor as (
    select distinct on (recurso) recurso, login, de, ate, qtd
      from validos order by recurso, qtd desc, login
  )
  insert into toa_recurso (base_id, recurso_id, login_toa,
                           primeira_vez, ultima_vez, vezes, empresa_id)
  select v_base, x.recurso, x.login, x.de, x.ate, x.qtd, v_empresa
    from vencedor x
  on conflict (base_id, recurso_id) do update
    set login_toa    = excluded.login_toa,
        ultima_vez   = greatest(toa_recurso.ultima_vez, excluded.ultima_vez),
        primeira_vez = least(toa_recurso.primeira_vez, excluded.primeira_vez),
        vezes        = toa_recurso.vezes + excluded.vezes;
  get diagnostics n_recurso = row_count;

  with novos as (
    select distinct btrim(l.dados->>'Tipo de Atividade__2') as nome
      from importacao_linha l
     where l.importacao_id = p_importacao_id
       and nullif(btrim(coalesce(l.dados->>'Tipo de Atividade__2','')),'') is not null
  )
  insert into tipo_atividade (nome, natureza, ativo, conferir, empresa_id)
  select x.nome, 'PRODUTIVA', true, true, v_empresa
    from novos x
   where not exists (select 1 from tipo_atividade t
                      where norm_txt(t.nome) = norm_txt(x.nome))
  on conflict (nome) do nothing;
  get diagnostics n_tipo = row_count;

  update visita v
     set tipo_atividade_id = t.id
    from tipo_atividade t
   where v.tipo_atividade_id is null
     and v.base_id = v_base
     and v.excluido_em is null
     and nullif(btrim(coalesce(v.dados_origem->>'Tipo de Atividade__2','')),'') is not null
     and norm_txt(t.nome) = norm_txt(v.dados_origem->>'Tipo de Atividade__2');
  get diagnostics n_ligado = row_count;

  update visita v
     set equipe_id = coalesce(v.equipe_id,
                              equipe_do_contrato(v.base_id, x.login, v.data_agendada)),
         tecnico_responsavel_id = coalesce(v.tecnico_responsavel_id, x.tecnico),
         atualizado_em = now()
    from (
      select vi.id,
             login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso') as login,
             (select t.id from tecnico t
               where t.base_id = vi.base_id
                 and norm_txt(t.matricula) =
                     norm_txt(login_do_recurso(vi.base_id,
                                               vi.dados_origem->>'ID do Recurso'))
               limit 1) as tecnico
        from visita vi
       where vi.base_id = v_base
         and vi.excluido_em is null
         and vi.rota_fixada_em is null
         and nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') is null
         and (vi.equipe_id is null or vi.tecnico_responsavel_id is null)
    ) x
   where v.id = x.id
     and x.login is not null;
  get diagnostics n_jornada = row_count;

  -- 082: as visitas que ESTA importacao TOCOU.
  -- Era `v.importacao_id = p_importacao_id`, e estava errado: o
  -- importador so carimba `importacao_id` no INSERT. Visita que ja
  -- existia e foi ATUALIZADA guarda o id da importacao que a CRIOU.
  -- Medido: a importacao das 18:31 trouxe 30 linhas e carimbou UMA
  -- visita -- o refresh do TEC1 pegava 1 de 30.
  -- `importacao_linha.visita_id` e o conjunto exato, e vem cheio.
  update ordem_servico o set tec1 = tec1_da_os(o.id)
   where o.visita_id in (select l.visita_id from importacao_linha l
                          where l.importacao_id = p_importacao_id
                            and l.visita_id is not null);
  get diagnostics n_tec1 = row_count;

  update visita v set tec1 = tec1_da_visita(v.id)
   where v.id in (select l.visita_id from importacao_linha l
                   where l.importacao_id = p_importacao_id
                     and l.visita_id is not null);

  return jsonb_build_object(
    'recursos_aprendidos', n_recurso,
    'tipos_criados', n_tipo,
    'visitas_ligadas_ao_tipo', n_ligado,
    'jornada_atribuida', n_jornada,
    'tec1_de_os', n_tec1);
end;
$function$;

revoke all on function public.reconciliar_importacao(uuid) from public, anon;
grant execute on function public.reconciliar_importacao(uuid) to authenticated;


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
              jornada jsonb, tec1 jsonb)
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
         jor.lista as jornada,
         -- `pct` NULO quando o denominador e zero: equipe sem O.S.
         -- avaliavel nao tem nota 0%, tem nota desconhecida (D-117).
         case when tec.equipe_id is null then null else jsonb_build_object(
           'padrao', tec.padrao, 'sem_padrao', tec.sem_padrao,
           'expurgada', tec.expurgada, 'sem_regra', tec.sem_regra,
           'pct', case when (tec.padrao + tec.sem_padrao) > 0
                       then round(100.0 * tec.padrao / (tec.padrao + tec.sem_padrao), 1)
                  end) end as tec1
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
       b.pontos_concluidos, b.pontos_sem_regra, b.jornada, b.tec1
  from base b;
$function$;

revoke all on function public.painel_equipes(date) from public, anon;
grant execute on function public.painel_equipes(date) to authenticated;

notify pgrst, 'reload schema';
