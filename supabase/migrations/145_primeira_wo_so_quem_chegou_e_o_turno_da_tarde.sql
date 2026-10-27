-- ┌─ 145 · PRIMEIRA WO: só conta quem CHEGOU, e a tarde tem meta própria ─┐
-- │ > "Ela já está contando contratos futuros que têm horário de início  │
-- │ >  e fim, porém eles nem tiveram status ainda (...) Precisa separar   │
-- │ >  as equipes que são da tarde e as equipes que são da manhã. As      │
-- │ >  equipes que entram à tarde, o horário padrão de estar no cliente   │
-- │ >  é 11h20 no máximo. As equipes que entram de manhã é 8h20. Para     │
-- │ >  saber se um técnico é da tarde ou não, precisa ver se ele          │
-- │ >  trabalhou à tarde durante 7 dias, com a primeira janela de 11 às   │
-- │ >  14. Se for mais de 7 dias, ele é da tarde."  — Emanuel, 26/10      │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ## 1. `inicio` preenchido NÃO quer dizer que o técnico chegou
--
-- A 140 usava `v.inicio is not null` como prova de chegada. Mas o TOA
-- preenche `inicio` com o horário **planejado** da atividade, muito antes
-- de alguém sair. Medido em 14 dias, por "Status da Atividade":
--
--   CONCLUIDO      1807  início real   (finalizado_toa em 1807)
--   NAO CONCLUIDO    44  início real   (finalizado_toa em 44)
--   INICIADO        129  início real
--   PENDENTE        292  PLANEJADO  ← entrava na conta, e vai até 20:27
--   EM ROTA          28  PLANEJADO  ← o técnico está indo, não chegou
--   CANCELADO       160  116 com início; cancelado pela central não foi
--
-- Chegada passa a ser o que o TOA **abriu**: CONCLUIDO, NAO CONCLUIDO ou
-- INICIADO. PENDENTE e EM ROTA são promessa, não chegada — e um PENDENTE
-- das 20:27 na média estraga o indicador inteiro. O CANCELADO entra só
-- quando o TOA o marcou concluído (aí houve atendimento); cancelado pela
-- central nunca, porque ninguém foi.
--
-- Efeito medido em 14 dias: 431 → 430 dias-técnico, **8 dias mudaram de
-- hora**, o mais tarde caiu de 15:09 para 15:07 e a média ficou em 08:40.
-- Pequeno no histórico fechado, grande no dia em andamento — que é onde
-- ele viu o defeito, com a rota do dia ainda cheia de PENDENTE.
--
-- Conferido depois de aplicar: das 430 linhas escolhidas, 415 concluído,
-- 13 não concluído, 2 iniciado. **Zero PENDENTE e zero EM ROTA.**
--
-- ## 2. Turno: a meta da tarde é 11:20
--
-- Classificação **por técnico**, derivada do dado e não de cadastro: nos
-- 30 dias anteriores ao fim do período, conta os dias em que a PRIMEIRA
-- janela dele começou 11:00 ou depois. **Mais de 7 dias ⇒ TARDE.**
--
-- As duas escolhas abaixo foram do Emanuel, perguntado com os números na
-- mão (26/10):
--   · janela de apuração: **30 dias** (e não 7 corridos, nem o histórico
--     inteiro — este último marcaria para sempre quem foi da tarde uma vez);
--   · o que é tarde: **qualquer primeira janela a partir das 11:00**, e
--     não só a 11-14. O dado tem 12:00-15:00, 14:00-17:00 e 15:00-18:00
--     também, e cobrar 08:20 de quem começa às 15h estaria errado.
--
-- A contagem olha a janela de TODO contrato produtivo com janela —
-- inclusive os que ele não chegou a abrir: a escala é o que a CLARO
-- mandou fazer, não o que ele conseguiu fazer.
--
-- É **uma classificação por técnico para o período inteiro**, não uma por
-- dia: por dia seriam 30 dias × N técnicos de releitura, e o turno de
-- alguém não muda de um dia para o outro.
--
-- ⚠ AVISO MEDIDO: o banco tem **9 dias de histórico**. Com 30 dias de
-- janela e corte em 7, **nenhum técnico é classificado como tarde hoje** —
-- 12 técnicos têm algum dia de tarde, o máximo é 5 dias. A regra está
-- certa e passa a valer sozinha conforme o histórico cresce; conferido
-- baixando o corte para 2, que classifica 2 técnicos como tarde.
--
-- Coluna nova no `returns table` ⇒ drop + create nas duas (traps.md), e
-- função recriada **nasce com a ACL aberta**: o revoke/grant não é enfeite.

insert into parametro (empresa_id, chave, valor, descricao)
select e.id, 'primeira_wo_meta_tarde', '"11:20"'::jsonb,
       'Hora limite da PRIMEIRA WO de quem trabalha a TARDE (145). '
       'Tecnico e da tarde quando, nos 30 dias anteriores, teve MAIS DE 7 '
       'dias com a primeira janela comecando 11:00 ou depois.'
  from empresa e
 where not exists (select 1 from parametro p
                    where p.empresa_id = e.id and p.chave = 'primeira_wo_meta_tarde');

-- ====================================================================
drop function if exists public.primeira_wo_tecnico(date, date);
drop function if exists public.primeira_wo_dia(date, date);

create function public.primeira_wo_dia(p_de date, p_ate date)
returns table(tecnico_id uuid, nome text, equipe text, dia date,
              hora time without time zone, visita_id uuid, contrato text,
              grupo text, endereco text, minutos_depois integer,
              dentro boolean, turno text, meta time without time zone)
language sql stable security definer
set search_path to 'public'
as $function$
  with meta as materialized (
    select coalesce((select (valor #>> '{}')::time from parametro
                      where empresa_id = minha_empresa() and chave = 'primeira_wo_meta'),
                    '08:20'::time) as manha,
           coalesce((select (valor #>> '{}')::time from parametro
                      where empresa_id = minha_empresa() and chave = 'primeira_wo_meta_tarde'),
                    '11:20'::time) as tarde
  ),
  /*
   * 145: o universo de quem CHEGOU. `inicio` sozinho nao prova nada --
   * o TOA o preenche com o horario planejado. Quem abriu a atividade
   * de verdade esta no "Status da Atividade".
   */
  chegou as (
    select v.id, v.tecnico_responsavel_id as tec, v.data_agendada as dia,
           v.inicio, v.janela_inicio, v.contrato, v.logradouro, v.bairro,
           v.tipo_servico_id, v.tipo_atividade_id
      from visita v
      join tipo_atividade ta on ta.id = v.tipo_atividade_id
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
   * 145: o turno sai do DADO. Nos 30 dias anteriores ao fim do periodo,
   * quantos dias a PRIMEIRA janela do tecnico comecou 11:00 ou depois.
   * Olha a janela de TODO contrato produtivo com janela -- inclusive os
   * que ele nao chegou a abrir: a escala e o que a CLARO mandou fazer,
   * nao o que ele conseguiu fazer.
   *
   * Uma classificacao por tecnico para o periodo inteiro, nao uma por
   * dia: por dia seriam 30 dias x N tecnicos de releitura, e o turno de
   * alguem nao muda de um dia para o outro.
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
           count(*) filter (where j.ji >= '11:00'::time) as dias_tarde
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
      select case when coalesce(tu.dias_tarde, 0) > 7 then 'TARDE' else 'MANHA' end as turno,
             case when coalesce(tu.dias_tarde, 0) > 7 then m.tarde else m.manha end as lim
    ) mt
   order by p.dia desc, p.hora desc;
$function$;

revoke all on function public.primeira_wo_dia(date, date) from public, anon;
grant execute on function public.primeira_wo_dia(date, date) to authenticated, service_role;

comment on function public.primeira_wo_dia(date, date) is
  '145: so conta contrato que o TOA ABRIU (status CONCLUIDO / NAO CONCLUIDO / '
  'INICIADO) -- PENDENTE e EM ROTA tem inicio PLANEJADO, nao chegada. O turno '
  'sai do dado: mais de 7 dias com a primeira janela a partir das 11:00, nos 30 '
  'dias anteriores, e TARDE (meta 11:20); senao MANHA (08:20). Ver D-227.';

-- ====================================================================
create function public.primeira_wo_tecnico(p_de date, p_ate date)
returns table(tecnico_id uuid, nome text, equipe text, dias integer,
              media_hora time without time zone, pior_hora time without time zone,
              melhor_hora time without time zone, dias_dentro integer,
              dias_fora integer, pct_dentro numeric, media_atraso_min numeric,
              turno text, meta time without time zone)
language sql stable security definer
set search_path to 'public'
as $function$
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
    from primeira_wo_dia(p_de, p_ate) d
   group by d.tecnico_id, d.nome, d.equipe, d.turno, d.meta
   order by count(*) filter (where not d.dentro) desc, avg(d.hora) desc;
$function$;

revoke all on function public.primeira_wo_tecnico(date, date) from public, anon;
grant execute on function public.primeira_wo_tecnico(date, date) to authenticated, service_role;

comment on function public.primeira_wo_tecnico(date, date) is
  '145: agrega primeira_wo_dia; turno e meta vem de la, uma regra em um lugar so.';

notify pgrst, 'reload schema';
