-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 156f · Indicador VT POR EQUIPE                                   ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "no quadro indicadores, crie um outro indicador ao lado da primeira
-- >  WO chamado VT por equipe. Ou seja, preciso de todos os logins
-- >  abertos e mostre quanto e que ele concluiu na linha dele (...) o
-- >  executado e o nao executado, cancelado e os outros codigos nao
-- >  contabilizam (...) qual e a media de execucao de cada tecnico (...)
-- >  tecnico de manutencao"  -- Emanuel, 30/10
--
-- Regra escolhida por ele (30/10): o "Status da Atividade" do TOA.
--   EXECUTADO     = CONCLUIDO
--   NAO EXECUTADO = NAO CONCLUIDO
--   fora da conta = cancelado, pendente, em rota, iniciado (ainda nao
--                   fechou) -- "os outros nao contabilizam".
--
-- ┌─ o que o dado mostra, e a tela precisa dizer ────────────────────┐
-- │ Medido em 14 dias, tecnicos de MANUTENCAO: 529 CONCLUIDO contra 7 │
-- │ NAO CONCLUIDO. No TOA, "concluido" inclui a VT fechada com codigo │
-- │ IMPRODUTIVO (203, rede externa...): o tecnico fecha a atividade,  │
-- │ so que sem o servico sair. Com esta regra a media de execucao    │
-- │ fica perto de 99% para quase todos -- a regra e a escolhida, e a │
-- │ tela escreve isso ao lado do numero, para ninguem ler 99% como    │
-- │ "99% dos servicos sairam".                                        │
-- └────────────────────────────────────────────────────────────────────┘
--
-- "Todos os logins abertos": todo tecnico ATIVO de skill MANUTENCAO da
-- cidade, inclusive quem nao fechou nada no periodo -- com zero e dias
-- escalados para a tela distinguir "nao trabalhou" de "trabalhou e nao
-- fechou".

create or replace function vt_por_equipe(p_de date, p_ate date, p_equipe text, p_buckets text[])
returns table (
  tecnico_id uuid, nome text, matricula text, equipe text,
  dias integer, executados integer, nao_executados integer, fora_da_conta integer,
  pct_execucao numeric, media_dia numeric, por_dia jsonb
)
language sql stable security definer set search_path = public as $$
  with v as materialized (
    select v.tecnico_responsavel_id as tec, v.data_agendada as dia,
           norm_txt(coalesce(v.dados_origem->>'Status da Atividade', '')) as st
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id and ta.natureza = 'PRODUTIVA'
      join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe eq on eq.id = t.equipe_id
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
       and v.contrato is not null
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (ve_cidade_inteira() or v.equipe_id in (select equipes_visiveis()))
       and (p_equipe is null or eq.codigo = p_equipe)
       and (p_buckets is null or cardinality(p_buckets) = 0
            or coalesce(v.toa_bucket, 'SEM_BUCKET') = any(p_buckets))
  ),
  dia as (
    select tec, dia,
           count(*) filter (where st = 'CONCLUIDO')::int as exe,
           count(*) filter (where st = 'NAO CONCLUIDO')::int as nao,
           count(*) filter (where st not in ('CONCLUIDO', 'NAO CONCLUIDO'))::int as fora
      from v group by tec, dia
  )
  select t.id, t.nome, t.matricula, e.codigo,
         count(d.dia)::int,
         coalesce(sum(d.exe), 0)::int,
         coalesce(sum(d.nao), 0)::int,
         coalesce(sum(d.fora), 0)::int,
         case when coalesce(sum(d.exe + d.nao), 0) > 0
              then round(100.0 * sum(d.exe) / sum(d.exe + d.nao), 1) end,
         case when count(d.dia) > 0 then round(coalesce(sum(d.exe), 0)::numeric / count(d.dia), 1) end,
         coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'exe', d.exe, 'nao', d.nao, 'fora', d.fora)
                  order by d.dia) filter (where d.dia is not null), '[]'::jsonb)
    from tecnico t
    left join equipe e on e.id = t.equipe_id
    left join dia d on d.tec = t.id
   where t.empresa_id = minha_empresa()
     and t.situacao = 'ATIVO'
     and t.skill = 'MANUTENÇÃO'
     and t.base_id in (select bases_visiveis())
     and (ve_cidade_inteira() or t.equipe_id in (select equipes_visiveis()))
     and (p_equipe is null or e.codigo = p_equipe)
     and (p_buckets is null or cardinality(p_buckets) = 0 or d.tec is not null)
   group by t.id, t.nome, t.matricula, e.codigo
   order by coalesce(sum(d.exe), 0) desc, t.nome;
$$;

comment on function vt_por_equipe(date, date, text, text[]) is
  'VT por equipe (156f): por tecnico de MANUTENCAO, executado = Status CONCLUIDO no TOA, nao executado = NAO CONCLUIDO; o resto fora da conta. Dia a dia em por_dia.';

revoke all on function vt_por_equipe(date, date, text, text[]) from public, anon;
grant execute on function vt_por_equipe(date, date, text, text[]) to authenticated;

notify pgrst, 'reload schema';
