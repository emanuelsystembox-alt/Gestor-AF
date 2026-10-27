-- ┌─ 144 · duas coisas que a tela não tinha como saber ────────────────┐
-- │ > "suba o nome do técnico também, não tem o nome, so login, e      │
-- │ >  numero"                                                          │
-- │ > "cancelado pela central que o técnico nem chegou a ir no          │
-- │ >  contrato (...) não é bom nem contabilizar o número do contrato  │
-- │ >  pra equipe, deve mostrar quando expandir, porém não entra na    │
-- │ >  contagem" — Emanuel, 26/10                                       │
-- └─────────────────────────────────────────────────────────────────────┘
--
-- ## 1. A Rota não sabia o nome de ninguém
--
-- `rota_do_dia` lia o nome em `dados_origem->>'Recurso'` — a coluna que
-- só UM dos dois formatos de export do TOA traz (D-091). Medido em
-- 26/10: **0 de 482** visitas do dia têm essa coluna, e por isso as 61
-- faixas da tela diziam todas "sem nome no TOA".
--
-- E o nome estava do lado: **482 de 482** têm `tecnico_responsavel_id`.
-- Então a ordem passa a ser o nosso cadastro primeiro e o "Recurso" do
-- TOA como reserva — o cadastro é declaração de gente, a planilha é
-- o que o TOA achou (D-079). `tecnico_matricula` vai junto porque a
-- faixa mostra as duas coisas.
--
-- ## 2. Cancelado pela central e Desatribuído não são trabalho da equipe
--
-- A D-223 já tinha tirado os dois da conta de QUEBRA, com a razão: quem
-- cancelou foi a central no TOA, antes de o técnico ir; e o 800 é
-- desatribuição nossa (116), não execução. O painel de Equipes continuava
-- contando os dois em tudo — contratos, O.S., pontos, TEC1, tempos e a
-- régua de períodos —, então a mesma empresa aparecia com dois números
-- para o mesmo dia conforme a tela.
--
-- Agora eles saem de tudo o que JULGA a equipe, e `fora_da_conta` conta
-- quantos são, para a tela poder dizer onde foram parar. A lista
-- expandida continua mostrando os contratos: sumir com eles seria trocar
-- um erro por outro — o controlador precisa ver que existem.
--
-- Medido em 26/10, entre os 342 contratos do dia: **29 cancelados pela
-- central e 20 desatribuídos**, em 54 equipes.
--
-- A jornada continua entrando (explica por que a equipe parou), e a
-- desconexão continua com o tratamento da 084.
--
-- Assinatura inalterada nas duas; `create or replace` não serve em
-- `rota_do_dia` nem em `painel_equipes` porque as duas ganham coluna no
-- `returns table` ("cannot change return type" — traps.md), então é
-- drop + create, e função recriada **nasce com a ACL aberta**: o
-- revoke/grant no fim não é enfeite.

-- ====================================================================
-- 1 · rota_do_dia: o nome vem do cadastro, e a origem do cancelamento
-- ====================================================================

drop function if exists public.rota_do_dia(date);

create function public.rota_do_dia(p_data date)
returns table(
  visita_id uuid, contrato text, login text, tecnico text,
  tecnico_matricula text, equipe text, equipe_id uuid, bairro text, area text,
  lat numeric, lng numeric, inicio timestamptz, fim timestamptz,
  finalizado_toa boolean, janela_inicio time, janela_fim time,
  situacao text, status_toa text, desatribuido boolean,
  tipo_servico text, tec1 text, ordem integer,
  km_desde_anterior double precision, voltou_ao_bairro boolean,
  baixa_codigos text, baixa_origem text, baixa_detalhe text,
  natureza text, tipo_atividade text)
language sql stable security definer
set search_path to 'public'
as $function$
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
           e.codigo as equipe, vi.equipe_id, vi.bairro, a.apelido as area,
           vi.lat, vi.lng, vi.inicio, vi.fim, vi.finalizado_toa,
           vi.janela_inicio, vi.janela_fim, vi.situacao, ts.nome as tipo_servico,
           -- 144: de onde veio o cancelamento, para o cartao poder
           -- dizer "Cancelado pela central" em vez de so "Cancelada".
           -- Mesma regra de `origemCancelada` na tela (filtroContratos).
           nullif(btrim(coalesce(vi.dados_origem->>'Status da Atividade','')),'') as status_toa,
           exists (
             select 1 from ordem_servico o
              join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
             where o.visita_id = vi.id and cb.codigo = 800
           ) as desatribuido,
           vi.tec1::text as tec1,
           coalesce(ta.natureza, 'PRODUTIVA') as natureza,
           ta.nome as tipo_atividade
      from visita vi
      left join equipe e on e.id = vi.equipe_id
      left join tecnico tc on tc.id = vi.tecnico_responsavel_id
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
         o.equipe, o.equipe_id,
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
         o.natureza, o.tipo_atividade
    from ord o
    left join ord ant on ant.login = o.login and ant.ordem = o.ordem - 1
                     and ant.natureza <> 'JORNADA'
    left join baixas b on b.visita_id = o.id
   order by o.login, o.inicio nulls last, o.ordem;
$function$;

revoke all on function public.rota_do_dia(date) from public, anon;
grant execute on function public.rota_do_dia(date) to authenticated, service_role;

comment on function public.rota_do_dia(date) is
  '144: o nome do tecnico sai do cadastro (tecnico_responsavel_id); o '
  '"Recurso" do TOA e reserva, porque so um dos formatos de export o traz. '
  'status_toa e desatribuido dizem de onde veio o cancelamento.';

notify pgrst, 'reload schema';
