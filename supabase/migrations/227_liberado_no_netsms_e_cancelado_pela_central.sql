-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 227 — "Liberado no Sistema NETSMS" é cancelado pela central (D-338)   │
-- │                                                                      │
-- │ "esse status em nosso sistema é pra baixar igual como se fosse       │
-- │  cancelado pela central, vamos puxar direto para cancelamento (...)  │
-- │  se tiver status não precisa puxar direto, só se não tiver"          │
-- │  — Emanuel, 07/11.                                                   │
-- │                                                                      │
-- │ O "Motivo de Fechamento Externo" LIBERADO NO SISTEMA NETSMS passa a  │
-- │ valer como o CANCELADO NO SISTEMA (198, D-289): cancelado pela       │
-- │ central. A regra do movimento (189, D-278) NÃO muda — com movimento  │
-- │ fica Em execução até a baixa do técnico; sem movimento vai direto    │
-- │ para Cancelado pela central.                                         │
-- │                                                                      │
-- │ Fora: o "Liberado" com o TOA CONCLUÍDO. Medido de 01 a 07/11: 6 a 10 │
-- │ por dia, e eles fecham pelo CÓDIGO (Reagendamento) — não foi pedido  │
-- │ mexer neles. O expurgo do TEC1 (tec1_da_os, D-047) é o livro da      │
-- │ CLARO e também não muda.                                             │
-- │                                                                      │
-- │ A regra existe duas vezes e muda junto: aqui e origemCancelada() em  │
-- │ app/src/lib/filtroContratos.ts.                                      │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.cancelado_pela_central(p_status text, p_motivo text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select norm_txt(coalesce(p_status, '')) = 'CANCELADO'
      or norm_txt(coalesce(p_motivo, '')) like '%CANCELADO NO SISTEMA%'
      -- 227: o "Liberado no Sistema NETSMS", fora o que o TOA deu como concluído
      or (norm_txt(coalesce(p_motivo, '')) like '%LIBERADO NO SISTEMA%'
          and norm_txt(coalesce(p_status, '')) <> 'CONCLUIDO');
$function$;

notify pgrst, 'reload schema';
