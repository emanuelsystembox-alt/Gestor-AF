-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ 240 — As janelas de atendimento da Nova O.S. saem do dado real       │
-- │                                                                      │
-- │ "adicionar mais janelas de atendimento que tem no sistema, tem       │
-- │  algumas que não foram reconhecidas ainda" — Emanuel, 09/11.         │
-- │                                                                      │
-- │ O Período do cadastro manual era uma lista fixa de 5 janelas         │
-- │ (08–11, 08–12, 11–14, 12–15, 15–18) e faltava justamente a MAIS      │
-- │ usada: 14:00–17:00. Medido em 09/11, 90 dias, só PRODUTIVA:          │
-- │   MAN  14–17 3.055 · 08–11 2.252 · 11–14 1.575 · 08–12 605 ·         │
-- │        15–18 535 · 17–20 328 · 08–10 279 · 10–12 196 · 14–16 187 ·   │
-- │        12–15 162 · 12–14 132 · 16–18 80 · 18–20 28                   │
-- │   SLS  14–17 2.424 · 08–11 2.043 · 11–14 1.019 · 08–10 274 ·         │
-- │        17–20 264 · 14–16 264 · 10–12 227 · 12–14 178 · 16–18 91 ·    │
-- │        18–20 44                                                      │
-- │ As cidades usam janelas diferentes: a lista é a da cidade ATIVA,     │
-- │ lida do que o TOA mandou, e não uma cópia na tela que envelhece.     │
-- │                                                                      │
-- │ O corte: últimos 90 dias, natureza PRODUTIVA (a jornada traz 12–13,  │
-- │ 13–14, 12–13:12 — Refeição não é janela de cliente), e pelo menos    │
-- │ 20 contratos na janela (abaixo disso é janela avulsa, de 1 a 13      │
-- │ ocorrências no histórico inteiro). Custo medido: 37 ms.              │
-- │                                                                      │
-- │ Devolve só HORÁRIOS e contagem — nada do assinante. É DEFINER para   │
-- │ a conta não pagar o RLS de `visita` por linha (traps.md), e por isso │
-- │ o escopo vai escrito: a cidade ativa (`bases_visiveis()`) dentro da  │
-- │ empresa de quem chama.                                               │
-- └──────────────────────────────────────────────────────────────────────┘

create or replace function public.janelas_de_atendimento()
returns table (janela_inicio text, janela_fim text, qtd bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select to_char(v.janela_inicio, 'HH24:MI'), to_char(v.janela_fim, 'HH24:MI'), count(*)
    from visita v
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
   where v.empresa_id = (select minha_empresa())
     and v.base_id in (select bases_visiveis())
     and v.data_agendada >= hoje_local() - 90
     and v.excluido_em is null
     and v.janela_inicio is not null
     and v.janela_fim is not null
     and v.janela_fim > v.janela_inicio
     and coalesce(ta.natureza, 'PRODUTIVA') = 'PRODUTIVA'
   group by v.janela_inicio, v.janela_fim
  having count(*) >= 20
   order by v.janela_inicio, v.janela_fim
$function$;

comment on function public.janelas_de_atendimento() is
  'Janelas (HH:MI) com 20+ contratos produtivos nos últimos 90 dias na cidade ativa — o Período da Nova O.S. (240).';

revoke all on function public.janelas_de_atendimento() from public, anon;
grant execute on function public.janelas_de_atendimento() to authenticated;

notify pgrst, 'reload schema';
