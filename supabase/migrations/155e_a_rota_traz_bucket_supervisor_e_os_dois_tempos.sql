-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155e · A ROTA ganha bucket, supervisor e os DOIS tempos          ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "no anexo 4 tambem devemos aplicar os filtros de bucket,
-- >  supervisor, janela, para poder a gente filtrar melhor ali os
-- >  tecnicos em campo (...) e ainda adicionar o tempo de deslocamento
-- >  e o tempo de execucao de cada um deles"  -- Emanuel, 29/10
--
-- A janela ja vinha (`janela_inicio`/`janela_fim`) e o filtro dela e so
-- tela. Bucket, supervisor e os dois tempos nao existiam aqui.
--
-- ┌─ o tempo de execucao tem DUAS armadilhas, as duas da D-227 ──────┐
-- │ 1. `inicio` preenchido NAO prova que o tecnico chegou: o TOA      │
-- │    manda o horario PLANEJADO. Quem abriu de verdade esta no       │
-- │    "Status da Atividade" (CONCLUIDO / NAO CONCLUIDO / INICIADO).  │
-- │ 2. Cancelado pela central e Desatribuido TEM inicio e fim, e nao  │
-- │    e execucao: e a janela que o TOA reservou. `fim - inicio` ali  │
-- │    viraria "42 min executando" num contrato onde ninguem foi.     │
-- │                                                                    │
-- │ Quando nao da para saber, a coluna vem NULA e o cartao nao        │
-- │ escreve nada -- zero diria "entrou e saiu na mesma hora".         │
-- │ Medido em 29/10: 477 paradas, 371 com execucao mensuravel.        │
-- └────────────────────────────────────────────────────────────────────┘
--
-- O deslocamento NAO e calculado aqui: e o `tempo_deslocamento` que o
-- TOA mede e manda na planilha. Calcular pelo nosso relogio seria o
-- defeito da D-224 de novo (`situacao_em` e a hora da importacao, igual
-- para a planilha inteira).
--
-- DROP e nao CREATE OR REPLACE: o `returns table` ganhou colunas, e o
-- Postgres recusa trocar o tipo de retorno. Funcao recriada do zero
-- nasce com a ACL aberta -- por isso o revoke/grant no fim.

drop function if exists rota_do_dia(date);

create function rota_do_dia(p_data date)
returns table (
  visita_id uuid, contrato text, login text, tecnico text, tecnico_matricula text,
  equipe text, equipe_id uuid, supervisor text, toa_bucket text,
  bairro text, area text, lat numeric, lng numeric,
  inicio timestamptz, fim timestamptz, finalizado_toa boolean,
  janela_inicio time, janela_fim time, situacao text, status_toa text,
  desatribuido boolean, tipo_servico text, tec1 text, ordem integer,
  km_desde_anterior double precision, voltou_ao_bairro boolean,
  baixa_codigos text, baixa_origem text, baixa_detalhe text,
  natureza text, tipo_atividade text,
  desloc_min integer, exec_min integer
)
language sql stable security definer set search_path = public as $function$
  with v as (
    select vi.id, vi.contrato,
           coalesce(
             nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),''),
             login_do_recurso(vi.base_id, vi.dados_origem->>'ID do Recurso')
           ) as login,
           -- 144: o cadastro primeiro. "Recurso" do TOA e reserva --
           -- ele vem em um so dos dois formatos de export (D-091), e
           -- em 26/10 veio vazio em 482 de 482 linhas do dia.
           coalesce(
             tc.nome,
             nullif(btrim(coalesce(vi.dados_origem->>'Recurso','')),'')
           ) as recurso,
           tc.matricula as tecnico_matricula,
           e.codigo as equipe, vi.equipe_id,
           -- O supervisor DECLARADO vale mais que o da planilha (068).
           coalesce(sup.nome, e.supervisor_nome) as supervisor,
           vi.toa_bucket,
           vi.bairro, a.apelido as area,
           vi.lat, vi.lng, vi.inicio, vi.fim, vi.finalizado_toa,
           vi.janela_inicio, vi.janela_fim, vi.situacao, ts.nome as tipo_servico,
           nullif(btrim(coalesce(vi.dados_origem->>'Status da Atividade','')),'') as status_toa,
           exists (
             select 1 from ordem_servico o
              join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
             where o.visita_id = vi.id and cb.codigo = 800
           ) as desatribuido,
           vi.tec1::text as tec1,
           coalesce(ta.natureza, 'PRODUTIVA') as natureza,
           ta.nome as tipo_atividade,
           (extract(epoch from vi.tempo_deslocamento) / 60)::int as desloc_min
      from visita vi
      left join equipe e on e.id = vi.equipe_id
      left join tecnico tc on tc.id = vi.tecnico_responsavel_id
      left join perfil sup on sup.id = tc.supervisor_id
      left join area_trabalho a on a.id = vi.area_id
      left join tipo_servico ts on ts.id = vi.tipo_servico_id
      left join tipo_atividade ta on ta.id = vi.tipo_atividade_id
     where vi.excluido_em is null
       and vi.data_agendada = p_data
       and vi.empresa_id = minha_empresa()
       and vi.base_id in (select bases_visiveis())
       and (eh_gestor() or vi.equipe_id in (select equipes_visiveis()))
  ),
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
  select o.id, o.contrato, o.login, o.recurso, o.tecnico_matricula,
         o.equipe, o.equipe_id, o.supervisor, o.toa_bucket,
         o.bairro, o.area, o.lat, o.lng, o.inicio, o.fim, o.finalizado_toa,
         o.janela_inicio, o.janela_fim,
         o.situacao, o.status_toa, o.desatribuido,
         o.tipo_servico, o.tec1, o.ordem::int,
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
         o.natureza, o.tipo_atividade,
         o.desloc_min,
         -- D-227: so conta como execucao o que alguem ABRIU no TOA e
         -- que nao e cancelamento da central nem desatribuicao nossa.
         case when o.inicio is not null and o.fim is not null
               and o.fim > o.inicio
               and norm_txt(coalesce(o.status_toa,'')) in ('CONCLUIDO','NAO CONCLUIDO','INICIADO')
               and not o.desatribuido
               and not (o.situacao = 'CANCELADA'
                        and norm_txt(coalesce(o.status_toa,'')) = 'CANCELADO')
              then (extract(epoch from (o.fim - o.inicio)) / 60)::int end
    from ord o
    left join ord ant on ant.login = o.login and ant.ordem = o.ordem - 1
                     and ant.natureza <> 'JORNADA'
    left join baixas b on b.visita_id = o.id
   order by o.login, o.inicio nulls last, o.ordem;
$function$;

comment on function rota_do_dia(date) is
  'A rota parada a parada (054/144a/155e). Traz bucket e supervisor para filtrar, e os dois tempos: deslocamento medido pelo TOA e execucao so de quem abriu a atividade (D-227).';

revoke all on function rota_do_dia(date) from public, anon;
grant execute on function rota_do_dia(date) to authenticated;

notify pgrst, 'reload schema';
