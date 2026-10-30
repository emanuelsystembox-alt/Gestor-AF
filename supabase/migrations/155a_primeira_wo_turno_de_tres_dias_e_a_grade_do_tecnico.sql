-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155a · A PRIMEIRA WO: o turno de 3 dias, e a grade dia a dia     ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "para a gente saber se um tecnico e da tarde, e bom a gente avaliar
-- >  3 a 4 dias com ele iniciando os primeiros contratos na janela de
-- >  11 a 14. Ai a gente considera que ele e da tarde. Se nao houver
-- >  isso, a gente considera que ele e da manha. A janela da tarde ela
-- >  inicia 11 horas, entao ele tem ate 11h20 para iniciar os contratos.
-- >  (...) e importante ter uma opcao onde o usuario clica em tabela do
-- >  tecnico (...) onde o usuario consegue visualizar dia a dia a WO de
-- >  todos os tecnicos de forma aberta, sem precisar entrar de um por
-- >  um (...) a media do tecnico"  -- Emanuel, 29/10
--
-- ┌─ o que estava errado, e o tamanho disso ─────────────────────────┐
-- │ A 145 classificou o turno com DOIS criterios que, juntos, nunca   │
-- │ disparavam:                                                        │
-- │   · "primeira janela >= 11:00" -- larga demais de um lado (pega a │
-- │     janela 14-17, que nao e a tarde de que ele fala);             │
-- │   · "em MAIS DE 7 dias dos ultimos 30" -- estreita demais.        │
-- │                                                                    │
-- │ Medido em 29/10 sobre 74 tecnicos com janela nos ultimos 30 dias: │
-- │   regra da 145 (>7 dias, >=11:00) ....... 0 tecnicos TARDE        │
-- │   regra nova (>=3 dias, 11:00-14:00) .... 2 tecnicos TARDE        │
-- │                                                                    │
-- │ Ou seja: a meta das 11h20 existia no banco e NUNCA foi aplicada a │
-- │ ninguem. Todo tecnico era cobrado pelas 08h20, inclusive quem a   │
-- │ CLARO escala para comecar as 11. Zero nao era "nenhum tecnico da  │
-- │ tarde": era a regra nao alcancando o dado.                        │
-- └────────────────────────────────────────────────────────────────────┘
--
-- O corte de dias vira PARAMETRO (`primeira_wo_dias_tarde`, 3): ele
-- disse "3 a 4" e escolheu 3, e quem opera muda sem migration.
--
-- A JANELA de tarde tambem e parametro (11:00-14:00): e a janela da
-- CLARO, nao uma constante nossa, e ela ja mudou uma vez.
--
-- ┌─ por que DROP e nao CREATE OR REPLACE ───────────────────────────┐
-- │ As duas funcoes ganham parametros novos (equipe e buckets). Com   │
-- │ default, a versao de 2 argumentos e a de 4 ficariam ambiguas para │
-- │ o PostgREST -- a armadilha do `baixar_os` em `traps.md`. Entao e  │
-- │ derrubar e recriar, e os chamadores (Indicadores.tsx) passam os   │
-- │ quatro. E funcao recriada do zero NASCE COM A ACL ABERTA: o       │
-- │ revoke/grant no fim nao e enfeite.                                │
-- └────────────────────────────────────────────────────────────────────┘

-- ---------------------------------------------------------------- --
--  1. os parametros
-- ---------------------------------------------------------------- --
insert into parametro (empresa_id, chave, valor, descricao)
select e.id, p.chave, p.valor, p.descricao
  from empresa e
  cross join (values
    ('primeira_wo_dias_tarde', '3'::jsonb,
     'Em quantos dias dos ultimos 30 a primeira janela do tecnico precisa cair na faixa da tarde para ele ser considerado do turno da tarde (145/155a). Emanuel, 29/10: "3 a 4 dias".'),
    ('primeira_wo_faixa_tarde', '{"inicio":"11:00","fim":"14:00"}'::jsonb,
     'A faixa de inicio de janela que caracteriza o turno da tarde (155a). A janela da tarde comeca as 11h.')
  ) as p(chave, valor, descricao)
on conflict (empresa_id, chave) do nothing;

-- ---------------------------------------------------------------- --
--  2. primeira_wo_dia -- turno novo + filtros de equipe e bucket
-- ---------------------------------------------------------------- --
drop function if exists primeira_wo_dia(date, date);
drop function if exists primeira_wo_tecnico(date, date);

create function primeira_wo_dia(
  p_de date, p_ate date, p_equipe text, p_buckets text[]
) returns table (
  tecnico_id uuid, nome text, equipe text, dia date, hora time,
  visita_id uuid, contrato text, grupo text, endereco text,
  minutos_depois integer, dentro boolean, turno text, meta time
)
language sql stable security definer set search_path = public as $$
  with meta as materialized (
    select coalesce((select (valor #>> '{}')::time from parametro
                      where empresa_id = minha_empresa() and chave = 'primeira_wo_meta'),
                    '08:20'::time) as manha,
           coalesce((select (valor #>> '{}')::time from parametro
                      where empresa_id = minha_empresa() and chave = 'primeira_wo_meta_tarde'),
                    '11:20'::time) as tarde,
           coalesce((select (valor ->> 'inicio')::time from parametro
                      where empresa_id = minha_empresa() and chave = 'primeira_wo_faixa_tarde'),
                    '11:00'::time) as faixa_ini,
           coalesce((select (valor ->> 'fim')::time from parametro
                      where empresa_id = minha_empresa() and chave = 'primeira_wo_faixa_tarde'),
                    '14:00'::time) as faixa_fim,
           coalesce((select (valor #>> '{}')::int from parametro
                      where empresa_id = minha_empresa() and chave = 'primeira_wo_dias_tarde'),
                    3) as dias_tarde
  ),
  /*
   * 145: o universo de quem CHEGOU. `inicio` sozinho nao prova nada --
   * o TOA o preenche com o horario planejado. Quem abriu a atividade
   * de verdade esta no "Status da Atividade".
   */
  chegou as (
    select v.id, v.tecnico_responsavel_id as tec, v.data_agendada as dia,
           v.inicio, v.contrato, v.logradouro, v.bairro,
           v.tipo_servico_id, v.tipo_atividade_id
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
      join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe eq on eq.id = t.equipe_id
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
       and v.inicio is not null
       and v.tecnico_responsavel_id is not null
       and ta.natureza = 'PRODUTIVA'
       and v.contrato is not null
       and norm_txt(coalesce(v.dados_origem->>'Status da Atividade',''))
             in ('CONCLUIDO', 'NAO CONCLUIDO', 'INICIADO')
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
       -- 155a: os mesmos filtros do Dashboard. Nulo = todos.
       and (p_equipe is null or eq.codigo = p_equipe)
       and (p_buckets is null or cardinality(p_buckets) = 0
            or coalesce(v.toa_bucket, 'SEM_BUCKET') = any(p_buckets))
  ),
  pri as (
    select distinct on (c.tec, c.dia)
           c.tec, c.dia,
           (c.inicio at time zone 'America/Manaus')::time as hora,
           c.id as visita_id, c.contrato,
           coalesce(ts.nome, ta.nome) as grupo,
           concat_ws(', ', c.logradouro, c.bairro) as endereco
      from chegou c
      join tipo_atividade ta on ta.id = c.tipo_atividade_id
      left join tipo_servico ts on ts.id = c.tipo_servico_id
     order by c.tec, c.dia, c.inicio
  ),
  /*
   * 155a: o turno sai do DADO -- da ESCALA, nao do que ele conseguiu
   * fazer: olha a janela de todo contrato produtivo, inclusive os que
   * ele nao abriu. Uma classificacao por tecnico para o periodo
   * inteiro; o turno de alguem nao muda de um dia para o outro.
   *
   * A mudanca da 155a: a faixa agora e 11:00-14:00 (era ">= 11:00",
   * que levava junto quem comeca as 14) e bastam 3 dias (eram mais de
   * 7, que nunca aconteceram).
   */
  janela_pri as (
    select distinct on (v.tecnico_responsavel_id, v.data_agendada)
           v.tecnico_responsavel_id as tec, v.data_agendada as dia,
           v.janela_inicio as ji
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
     where v.data_agendada between p_ate - 30 and p_ate
       and v.excluido_em is null
       and v.contrato is not null
       and v.tecnico_responsavel_id is not null
       and v.janela_inicio is not null
       and ta.natureza = 'PRODUTIVA'
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
     order by v.tecnico_responsavel_id, v.data_agendada, v.janela_inicio, v.inicio
  ),
  turnos as (
    select j.tec,
           count(*) filter (
             where j.ji >= (select faixa_ini from meta)
               and j.ji <  (select faixa_fim from meta)) as dias_tarde
      from janela_pri j group by j.tec
  )
  select p.tec, t.nome, e.codigo, p.dia, p.hora, p.visita_id, p.contrato,
         p.grupo, p.endereco,
         (extract(epoch from (p.hora - mt.lim)) / 60)::integer,
         p.hora <= mt.lim,
         mt.turno,
         mt.lim
    from pri p
    join tecnico t on t.id = p.tec
    left join equipe e on e.id = t.equipe_id
    left join turnos tu on tu.tec = p.tec
    cross join meta m
    cross join lateral (
      select case when coalesce(tu.dias_tarde, 0) >= m.dias_tarde then 'TARDE' else 'MANHA' end as turno,
             case when coalesce(tu.dias_tarde, 0) >= m.dias_tarde then m.tarde else m.manha end as lim
    ) mt
   order by p.dia desc, p.hora desc;
$$;

comment on function primeira_wo_dia(date, date, text, text[]) is
  'A primeira WO aberta de cada tecnico em cada dia (140/145/155a). Turno da tarde: primeira janela entre 11h e 14h em pelo menos `primeira_wo_dias_tarde` dias dos ultimos 30.';

-- ---------------------------------------------------------------- --
--  3. primeira_wo_tecnico -- a media de cada um, com os filtros
-- ---------------------------------------------------------------- --
create function primeira_wo_tecnico(
  p_de date, p_ate date, p_equipe text, p_buckets text[]
) returns table (
  tecnico_id uuid, nome text, equipe text, dias integer,
  media_hora time, pior_hora time, melhor_hora time,
  dias_dentro integer, dias_fora integer, pct_dentro numeric,
  media_atraso_min numeric, turno text, meta time
)
language sql stable security definer set search_path = public as $$
  select d.tecnico_id, d.nome, d.equipe, count(*)::integer,
         avg(d.hora)::time, max(d.hora), min(d.hora),
         count(*) filter (where d.dentro)::integer,
         count(*) filter (where not d.dentro)::integer,
         round(100.0 * count(*) filter (where d.dentro) / count(*), 1),
         -- So o atraso conta na media do atraso: quem chegou antes nao
         -- "compensa" o dia em que chegou tarde (seria media de sinal
         -- trocado, e esconderia o problema).
         round(avg(d.minutos_depois) filter (where not d.dentro), 1),
         d.turno, d.meta
    from primeira_wo_dia(p_de, p_ate, p_equipe, p_buckets) d
   group by d.tecnico_id, d.nome, d.equipe, d.turno, d.meta
   order by count(*) filter (where not d.dentro) desc, avg(d.hora) desc;
$$;

-- ---------------------------------------------------------------- --
--  4. a GRADE: todos os tecnicos, dia a dia, de uma vez
-- ---------------------------------------------------------------- --
--
-- > "todos os tecnicos ja ficam abertos nessa tabela, onde a gente
-- >  consegue saber ali a media do tecnico" -- Emanuel, 29/10
--
-- Uma linha por tecnico, com os dias dentro num jsonb: o front monta a
-- grade sem N consultas. `dias_sem_wo` e a conta que falta na tela de
-- hoje -- dia em que o tecnico estava escalado e nao abriu NENHUMA WO
-- nao e "media boa", e buraco, e some de qualquer media.
--
-- Com filtro de bucket so aparece quem teve contrato naquele bucket:
-- bucket e do contrato, nao do tecnico, e nao da para dizer de que
-- bucket e um tecnico que nao tem contrato nenhum.
create or replace function primeira_wo_grade(
  p_de date, p_ate date, p_equipe text, p_buckets text[]
) returns table (
  tecnico_id uuid, nome text, matricula text, equipe text,
  turno text, meta time, dias integer, dias_dentro integer,
  media_hora time, pct_dentro numeric, media_atraso_min numeric,
  dias_escalado integer, dias_sem_wo integer, por_dia jsonb
)
language sql stable security definer set search_path = public as $$
  with d as (
    select * from primeira_wo_dia(p_de, p_ate, p_equipe, p_buckets)
  ),
  -- Em quantos dias do periodo o tecnico tinha contrato produtivo com
  -- janela (= estava escalado). Folga nao e falta, aqui tambem.
  escala as (
    select v.tecnico_responsavel_id as tec, count(distinct v.data_agendada)::integer as dias
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
      join tecnico t on t.id = v.tecnico_responsavel_id
      left join equipe eq on eq.id = t.equipe_id
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
       and v.contrato is not null
       and ta.natureza = 'PRODUTIVA'
       and v.tecnico_responsavel_id is not null
       and v.empresa_id = minha_empresa()
       and v.base_id in (select bases_visiveis())
       and (eh_gestor() or v.equipe_id in (select equipes_visiveis()))
       and (p_equipe is null or eq.codigo = p_equipe)
       and (p_buckets is null or cardinality(p_buckets) = 0
            or coalesce(v.toa_bucket, 'SEM_BUCKET') = any(p_buckets))
     group by 1
  )
  select t.id, t.nome, t.matricula, e.codigo,
         coalesce(max(d.turno), 'MANHA'),
         max(d.meta),
         count(d.dia)::integer,
         count(*) filter (where d.dentro)::integer,
         avg(d.hora)::time,
         case when count(d.dia) > 0
              then round(100.0 * count(*) filter (where d.dentro) / count(d.dia), 1) end,
         round(avg(d.minutos_depois) filter (where not d.dentro), 1),
         coalesce(max(es.dias), 0),
         greatest(coalesce(max(es.dias), 0) - count(d.dia), 0)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
                    'dia', d.dia, 'hora', to_char(d.hora, 'HH24:MI'),
                    'dentro', d.dentro, 'min', d.minutos_depois,
                    'visita_id', d.visita_id, 'contrato', d.contrato)
                  order by d.dia) filter (where d.dia is not null), '[]'::jsonb)
    from tecnico t
    left join equipe e on e.id = t.equipe_id
    left join escala es on es.tec = t.id
    left join d on d.tecnico_id = t.id
   where t.empresa_id = minha_empresa()
     and t.situacao = 'ATIVO'
     and t.base_id in (select bases_visiveis())
     and (eh_gestor() or t.equipe_id in (select equipes_visiveis()))
     and (p_equipe is null or e.codigo = p_equipe)
     -- Sem contrato no bucket filtrado, o tecnico nao tem como aparecer.
     and (p_buckets is null or cardinality(p_buckets) = 0 or es.tec is not null)
   group by t.id, t.nome, t.matricula, e.codigo
   order by count(*) filter (where d.dia is not null and not d.dentro) desc,
            avg(d.hora) desc nulls last, t.nome;
$$;

comment on function primeira_wo_grade(date, date, text, text[]) is
  'A grade da Primeira WO (155a): um tecnico por linha, os dias dentro de `por_dia`, mais a media e os dias escalados sem nenhuma WO aberta.';

-- ---------------------------------------------------------------- --
--  5. a ACL -- funcao recriada do zero nasce aberta (security.md)
-- ---------------------------------------------------------------- --
revoke all on function primeira_wo_dia(date, date, text, text[]) from public, anon;
revoke all on function primeira_wo_tecnico(date, date, text, text[]) from public, anon;
revoke all on function primeira_wo_grade(date, date, text, text[]) from public, anon;
grant execute on function primeira_wo_dia(date, date, text, text[]) to authenticated;
grant execute on function primeira_wo_tecnico(date, date, text, text[]) to authenticated;
grant execute on function primeira_wo_grade(date, date, text, text[]) to authenticated;

notify pgrst, 'reload schema';
