-- ============================================================
-- 076 · O cartão da rota mostra a baixa
--
-- > "adicione os códigos de baixa também dentro da caixa, e por último a
-- >  janela de atendimento" — Emanuel, 14/09
--
-- A janela já vinha (`janela_inicio` / `janela_fim`, desde a 054). O que
-- faltava era a baixa — e ela não é UMA:
--
-- ┌─ são DUAS baixas, e elas divergem ───────────────────────────────┐
-- │ A da operadora vem do TOA e não se edita (D-042). A da AFLINE é a │
-- │ nossa afirmação do que aconteceu. Mostrar só uma das duas num     │
-- │ cartão de 8 rem seria escolher em silêncio qual verdade contar.   │
-- │                                                                   │
-- │ Então: `baixa_codigos` traz a NOSSA quando existe, senão a da     │
-- │ operadora, e `baixa_origem` diz qual das duas está na tela. O     │
-- │ `baixa_detalhe` carrega as duas por extenso, com descrição, para  │
-- │ a dica do cartão — é lá que a divergência aparece inteira.        │
-- └───────────────────────────────────────────────────────────────────┘
--
-- ┌─ por que é uma LISTA e não um código ────────────────────────────┐
-- │ Uma visita tem de 1 a 10 O.S., e o caso mais comum é 2            │
-- │ (business-rules.md). Cada O.S. tem o seu código. "O código de     │
-- │ baixa do contrato" não existe: existe o conjunto. Duas O.S. com   │
-- │ 409 e 430 viram "409 · 430", e não a primeira que o banco         │
-- │ devolver.                                                          │
-- └───────────────────────────────────────────────────────────────────┘
--
-- O resto do corpo é o da 075, sem diferença: mesmo escopo de RLS,
-- mesma exclusão de JORNADA, mesmo `km_entre`, mesmo `voltou_ao_bairro`.
--
-- DROP e não CREATE OR REPLACE: coluna nova no `returns table`. E função
-- `security definer` recriada do zero nasce com a ACL aberta ao anon —
-- o revoke no fim não é decoração (par 059 → 061).
-- ============================================================

drop function if exists public.rota_do_dia(date);

create function public.rota_do_dia(p_data date)
returns table(visita_id uuid, contrato text, login text, tecnico text,
              equipe text, equipe_id uuid, bairro text, area text,
              lat numeric, lng numeric,
              inicio timestamp with time zone, fim timestamp with time zone,
              finalizado_toa boolean,
              janela_inicio time without time zone,
              janela_fim time without time zone,
              situacao text, tipo_servico text, tec1 text, ordem integer,
              km_desde_anterior double precision, voltou_ao_bairro boolean,
              baixa_codigos text, baixa_origem text, baixa_detalhe text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with v as (
    select vi.id, vi.contrato,
           nullif(btrim(coalesce(vi.dados_origem->>'Login do Técnico','')),'') as login,
           nullif(btrim(coalesce(vi.dados_origem->>'Recurso','')),'')          as recurso,
           e.codigo as equipe, vi.equipe_id, vi.bairro, a.apelido as area,
           vi.lat, vi.lng, vi.inicio, vi.fim, vi.finalizado_toa,
           vi.janela_inicio, vi.janela_fim, vi.situacao, ts.nome as tipo_servico,
           vi.tec1::text as tec1
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
       -- Jornada não é rota (regra do CLAUDE.md).
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  ord as (
    select v.*, row_number() over (partition by v.login
                                   order by v.inicio nulls last, v.id) as ordem
      from v where v.login is not null
  ),
  -- 076: as baixas das O.S. de cada visita, as duas.
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
         km_entre(ant.lat::float8, ant.lng::float8, o.lat::float8, o.lng::float8),
         exists (select 1 from ord x
                  where x.login = o.login and x.ordem < o.ordem - 1
                    and norm_txt(x.bairro) = norm_txt(o.bairro)
                    and o.bairro is not null),
         -- A nossa tem precedência: se alguém daqui declarou, é isso que vale.
         coalesce(b.af_cods, b.toa_cods),
         case when b.af_cods is not null then 'AFLINE'
              when b.toa_cods is not null then 'TOA' end,
         nullif(concat_ws(chr(10), b.af_det, b.toa_det), '')
    from ord o
    left join ord ant on ant.login = o.login and ant.ordem = o.ordem - 1
    left join baixas b on b.visita_id = o.id
   order by o.login, o.ordem;
$function$;

revoke all on function public.rota_do_dia(date) from public, anon;
grant execute on function public.rota_do_dia(date) to authenticated;

notify pgrst, 'reload schema';
