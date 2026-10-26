-- ┌─ 142 · o painel da quebra no formato que a CLARO usa ──────────────┐
-- │ > "tire o gráfico Onde a quebra aconteceu, ele não vai nos ajudar. │
-- │ >  (...) preciso melhorar as improdutivas por responsabilidade.    │
-- │ >  Precisa usar a responsabilidade igual ao anexo 2 (...) temos o  │
-- │ >  maior ofensor como agendamento, depois processo de venda,       │
-- │ >  depois infra claro (...) quando eu botar o mouse em cima dessas │
-- │ >  barras, a ideia é aparecer também um resumo" — Emanuel, 26/10   │
-- │                                                                     │
-- │ O painel que ele já usa tem o AGRUPAMENTO no eixo — não o          │
-- │ responsável. Os dois painéis da 141 viraram UM, nesse formato:     │
-- │ impacto sobre o total de UN, volume, fatia das quebras, variação   │
-- │ em p.p. contra o período anterior e, no mouse, os motivos.         │
-- │                                                                     │
-- │ O período ATUAL a tela calcula com os filtros que estão nela; esta │
-- │ RPC devolve o ANTERIOR, agregado — uma viagem, sem trazer as       │
-- │ visitas do período passado para o navegador. Com filtro ligado a   │
-- │ seta NÃO aparece: o anterior vem sem filtro, e comparar os dois    │
-- │ seria comparar coisas diferentes e chamar de melhora.              │
-- │                                                                     │
-- │ UN = O.S. COM BAIXA, o mesmo denominador do cabeçalho do painel    │
-- │ ("328 de 2305 O.S. com baixa"). Dois denominadores na mesma tela   │
-- │ seria a contradição da D-150 de novo.                              │
-- └─────────────────────────────────────────────────────────────────────┘

create or replace function public.impacto_quebra(p_de date, p_ate date)
returns table(agrupamento text, quebras bigint, total_un bigint, pct_un numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with os as (
    select c.natureza, c.agrupamento_quebra
      from ordem_servico o
      join visita v on v.id = o.visita_id
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      join codigo_baixa c on c.id = o.codigo_baixa_id
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  tot as materialized (select count(*) as un from os)
  select coalesce(o.agrupamento_quebra, 'SEM_AGRUPAMENTO'),
         count(*), t.un,
         case when t.un > 0 then round(100.0 * count(*) / t.un, 2) end
    from os o cross join tot t
   where o.natureza = 'IMPRODUTIVA'
   group by 1, t.un
   order by 2 desc;
$function$;

revoke all on function public.impacto_quebra(date, date) from public, anon;
grant execute on function public.impacto_quebra(date, date) to authenticated, service_role;

-- PENDENTE DO EMANUEL: 8 códigos improdutivos sem agrupamento, 76 O.S.
-- em 7 dias (23% das quebras). Não estão na planilha de 01/10, ou a
-- maioria dela ficou abaixo de 50% (o 301, com 25%):
--   301 Tipo de OS Incorreta (23)      402 Divergência de Dados Cadastrais (22)
--   110 Problema Na Tubulação (13)     305 Rua não cabeada (9)
--   205 Falta Tap Ou Passivo (5)       316 Rua não cabeada GPON (2)
--   206 Prédio Sem Backbone (1)        211 Falta NAP/NAP Lotada (1)
-- Enquanto ele não disser, eles aparecem como "sem agrupamento" — e a
-- tela diz isso, em vez de empurrar para um grupo qualquer.

notify pgrst, 'reload schema';
