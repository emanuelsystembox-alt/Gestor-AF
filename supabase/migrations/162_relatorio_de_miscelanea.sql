-- ┌─ 162 · o relatório de miscelânea ──────────────────────────────────┐
-- │ > "relatório de miscelânea, vamos deixar em relatórios também, uma │
-- │ >  opção para relatórios de miscelâneas. Aí deve mostrar a equipe, │
-- │ >  a WO, contrato, o que ele lançou de cada item"                  │
-- │ >  — Emanuel, 30/10                                                │
-- │                                                                    │
-- │ Uma linha por ITEM lançado no contrato, de duas fontes, lado a     │
-- │ lado e sem somar uma na outra:                                     │
-- │                                                                    │
-- │   TOA     — o que a varredura leu (visita_equipamento_toa com      │
-- │             miscelanea = true; 117, D-192). É onde o técnico       │
-- │             lança hoje: 547 linhas em 30/10.                       │
-- │   TÉCNICO — o que ele baixou pelo aplicativo (miscelanea_movimento │
-- │             CONSUMO amarrado ao contrato; 094). 0 linhas em 30/10. │
-- │                                                                    │
-- │ Não se casa uma com a outra nem se escolhe a "certa": a regra de   │
-- │ correção do lançamento continua em aberto (D-192), e as duas       │
-- │ juntas é que mostram a diferença.                                  │
-- │                                                                    │
-- │ SECURITY DEFINER porque `miscelanea_movimento` e `item_miscelanea` │
-- │ só são legíveis com `almoxarifado.ver` — e o relatório é de quem   │
-- │ vê o CONTRATO. O escopo é a cópia da policy `visita_leitura`        │
-- │ (cidade ativa SEMPRE, depois cidade inteira ou equipe legível), e  │
-- │ não o `or tem_permissao('almoxarifado.ver')` do material_do_toa,   │
-- │ que derruba o filtro de cidade (armadilha D-235). As funções de    │
-- │ escopo vão em (select …): soltas, custavam 231 ms contra 9 (D-118).│
-- └────────────────────────────────────────────────────────────────────┘

create or replace function public.relatorio_miscelanea(p_de date, p_ate date)
returns table(
  visita_id uuid, data_agendada date, cidade text,
  equipe text, equipe_nome text, supervisor text,
  tecnico text, matricula text,
  wo text, contrato text, atividade_toa text, grupo_servico text, situacao text,
  fonte text, movimento text, tecnologia text,
  codigo text, item text, unidade text, quantidade numeric,
  em timestamptz, por text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with vis as materialized (
    select v.* from visita v
     where v.empresa_id = (select minha_empresa())
       and v.base_id in (select bases_visiveis())
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_legiveis()))
       and v.excluido_em is null
       and v.data_agendada between p_de and p_ate
  ),
  itens as (
    -- O que o TOA mostra. O código SAP é o começo do nome
    -- ("22062579_FONTE…" → 22062579), como no material_do_toa (125).
    select t.id, t.visita_id, 'TOA'::text as fonte,
           case t.secao when 'DESINSTALADO' then 'RETIRADO' else 'INSTALADO' end as movimento,
           t.tipo as tecnologia,
           coalesce(i.codigo, nullif(split_part(t.modelo, '_', 1), t.modelo)) as codigo,
           coalesce(i.nome, t.modelo) as item, i.unidade,
           t.quantidade, t.lido_em as em, null::text as por
      from visita_equipamento_toa t
      join vis on vis.id = t.visita_id
      left join item_miscelanea i
             on i.empresa_id = t.empresa_id and i.codigo = split_part(t.modelo, '_', 1)
     where t.miscelanea
    union all
    -- O que o técnico baixou pelo aplicativo. CONSUMO sai negativo do
    -- saldo dele; no relatório é a quantidade gasta, positiva.
    select m.id, m.visita_id, 'TÉCNICO', 'INSTALADO', null,
           i.codigo, i.nome, i.unidade,
           -m.quantidade, m.criado_em, p.nome
      from miscelanea_movimento m
      join vis on vis.id = m.visita_id
      join item_miscelanea i on i.id = m.item_id
      left join perfil p on p.id = m.criado_por
     where m.tipo = 'CONSUMO'
  )
  select v.id, v.data_agendada, b.nome,
         e.codigo, e.nome, e.supervisor_nome,
         tc.nome, tc.matricula,
         v.wo_numero, v.contrato, ta.nome, ts.nome, v.situacao,
         x.fonte, x.movimento, x.tecnologia,
         x.codigo, x.item, x.unidade, x.quantidade,
         x.em, x.por
    from itens x
    join vis v on v.id = x.visita_id
    left join base b           on b.id = v.base_id
    left join equipe e         on e.id = v.equipe_id
    left join tecnico tc       on tc.id = v.tecnico_responsavel_id
    left join tipo_atividade ta on ta.id = v.tipo_atividade_id
    left join tipo_servico ts  on ts.id = v.tipo_servico_id
   -- Ordem total, para a tela poder paginar sem pular nem repetir linha.
   order by v.data_agendada, e.codigo nulls last, v.contrato nulls last, v.id,
            x.fonte, x.movimento, x.item, x.em, x.id;
$function$;

revoke all on function public.relatorio_miscelanea(date, date) from public, anon;
grant execute on function public.relatorio_miscelanea(date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
