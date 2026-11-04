-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 197 — O técnico vê para onde foi o contrato cancelado                 │
-- │                                                                      │
-- │ "o técnico precisa saber no app para onde foi o contrato de sua      │
-- │  linha, se ele foi auditado ou cancelado, ele precisa ter essa       │
-- │  ciência (...) então o contrato não pode sumir da linha dele no app" │
-- │  — Emanuel, 03/11.                                                   │
-- │                                                                      │
-- │ Medido em 03/11: os 40 cancelados pela central e os auditados do dia │
-- │ ficaram na equipe do técnico — não somem da agenda, aparecem em      │
-- │ "Baixadas" como "Cancelada", sem dizer de onde veio. Esta função dá  │
-- │ a ORIGEM, com a mesma regra da web (`origemCancelada`,               │
-- │ lib/filtroContratos.ts): o 800 do sistema = AUDITAR; "cancelado" no  │
-- │ TOA = CANCELADO_CENTRAL; o resto (cancelado por código) não volta.   │
-- │                                                                      │
-- │ INVOKER: o RLS de `visita` decide — o técnico só recebe os dele.     │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.origem_do_cancelamento(p_visitas uuid[])
returns table (visita_id uuid, origem text)
language sql
stable
set search_path to 'public'
as $function$
  select v.id,
         case when v.desatribuido_em is not null
                or exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                            where o.visita_id = v.id and cb.codigo = 800)
              then 'AUDITAR'
              when norm_txt(coalesce(v.dados_origem ->> 'Status da Atividade', '')) = 'CANCELADO'
              then 'CANCELADO_CENTRAL' end
    from visita v
   where v.id = any (p_visitas)
     and v.situacao = 'CANCELADA'
     and (v.desatribuido_em is not null
          or norm_txt(coalesce(v.dados_origem ->> 'Status da Atividade', '')) = 'CANCELADO'
          or exists (select 1 from ordem_servico o join codigo_baixa cb on cb.id = o.codigo_baixa_afline_id
                      where o.visita_id = v.id and cb.codigo = 800));
$function$;

revoke all on function public.origem_do_cancelamento(uuid[]) from public, anon;
grant execute on function public.origem_do_cancelamento(uuid[]) to authenticated;

notify pgrst, 'reload schema';
