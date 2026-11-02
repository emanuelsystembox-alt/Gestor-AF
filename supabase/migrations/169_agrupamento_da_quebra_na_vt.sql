-- ┌─ 169 · o agrupamento da quebra pode ser outro na VT (D-255) ───────┐
-- │ > "se for instalação, 301 é Comercial; se for VT, 301 é Causa     │
-- │ >  Cliente" — Emanuel, 02/11                                       │
-- │                                                                     │
-- │ Até aqui cada código de baixa tinha UM agrupamento (141/143). O    │
-- │ 301 (Tipo de OS Incorreta) é o primeiro que muda com o serviço.    │
-- │ Perguntado, o Emanuel decidiu: "Comercial" é o PROCESSO VENDA e    │
-- │ "Causa Cliente" é o INFRA CLIENTE que já existem; e quem diz se é  │
-- │ VT é o GRUPO DE SERVIÇO VISITA TECNICA (não o bucket _VT).         │
-- │                                                                     │
-- │ `agrupamento_quebra_vt`: o grupo na VT. Nulo = o mesmo de sempre — │
-- │ nenhum outro código muda. A regra está em `agrupamento_da_quebra`, │
-- │ que a tela repete em `lib/metricas.ts` (o painel do dia é calculado│
-- │ na tela; o período anterior, aqui).                                │
-- │                                                                     │
-- │ Medido: o 301 apareceu em 50 O.S. — 7 em VISITA TECNICA, 43 em     │
-- │ SERVICO/ADESAO/MIGRACAO GPON/REINSTALACAO/MUDANCA DE ENDERECO.     │
-- └─────────────────────────────────────────────────────────────────────┘

alter table codigo_baixa add column if not exists agrupamento_quebra_vt text;

create or replace function public.agrupamento_da_quebra(p_agrupamento text, p_agrupamento_vt text, p_grupo_servico text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case when p_grupo_servico = 'VISITA TECNICA' and p_agrupamento_vt is not null
              then p_agrupamento_vt else p_agrupamento end;
$function$;
revoke all on function public.agrupamento_da_quebra(text, text, text) from public, anon;
grant execute on function public.agrupamento_da_quebra(text, text, text) to authenticated;

update codigo_baixa
   set agrupamento_quebra = 'PROCESSO VENDA', agrupamento_quebra_vt = 'INFRA CLIENTE'
 where codigo = 301;

-- O período anterior do painel: a mesma regra, com o grupo de serviço da visita.
create or replace function public.impacto_quebra(p_de date, p_ate date)
 returns table(agrupamento text, quebras bigint, total_un bigint, pct_un numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with vis as (
    select v.id, ts.nome as grupo_servico,
           -- 143: o que NAO e quebra. Cancelado pela central (o TOA
           -- cancelou antes de o tecnico ir) e Auditar (o 800 e nosso,
           -- nao da operacao) saem da conta, como na tela.
           (v.situacao = 'CANCELADA' and (
              norm_txt(coalesce(v.dados_origem->>'Status da Atividade','')) = 'CANCELADO'
              or v.desatribuido_em is not null
              or exists (select 1 from ordem_servico o2
                          join codigo_baixa c2 on c2.id = o2.codigo_baixa_afline_id
                         where o2.visita_id = v.id and c2.codigo = 800))) as fora
      from visita v
      left join tipo_atividade ta on ta.id = v.tipo_atividade_id
      left join tipo_servico ts on ts.id = v.tipo_servico_id
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (((select ve_cidade_inteira()) and v.base_id in (select bases_visiveis())) or v.equipe_id in (select equipes_legiveis()))
       and coalesce(ta.natureza, 'PRODUTIVA') <> 'JORNADA'
  ),
  os as (
    -- 169: o agrupamento pode ser outro na VT
    select c.natureza, agrupamento_da_quebra(c.agrupamento_quebra, c.agrupamento_quebra_vt, vis.grupo_servico) as agrupamento_quebra,
           c.situacao_destino, vis.fora
      from ordem_servico o
      join vis on vis.id = o.visita_id
      join codigo_baixa c on c.id = o.codigo_baixa_id
  ),
  tot as materialized (select count(*) as un from os)
  select coalesce(o.agrupamento_quebra, 'SEM_AGRUPAMENTO'),
         count(*), t.un,
         case when t.un > 0 then round(100.0 * count(*) / t.un, 2) end
    from os o cross join tot t
   where o.natureza = 'IMPRODUTIVA'
     and not o.fora
     and coalesce(o.agrupamento_quebra, '') <> 'SEM_QUEBRA'
     and coalesce(o.situacao_destino, '') <> 'CONCLUIDA'
   group by 1, t.un
   order by 2 desc;
$function$;

notify pgrst, 'reload schema';
