-- 233 · Primeira WO: o turno é calculado UMA vez, não uma vez por técnico-dia
--
-- A tela Indicadores › Primeira WO caiu em "canceling statement due to
-- statement timeout" (Emanuel, 09/11). Medido como authenticated, Manaus,
-- 26/10 a 09/11 (3.897 contratos): primeira_wo_dia levava 35 s e
-- primeira_wo_tecnico 32 s — o teto do authenticated é 8 s.
--
-- O corpo da consulta, rodado solto com as datas escritas, leva 0,4 s. Dentro
-- da função as datas são parâmetros, o plano é GENÉRICO, e nele o CTE
-- `turnos` (os 30 dias de janela de cada técnico, para saber se ele é da
-- manhã ou da tarde) era embutido no laço e refeito para CADA técnico-dia:
-- loops=373, ~100 ms cada. É a armadilha do CTE referenciado uma vez que vira
-- inline (traps.md): `materialized` faz a conta uma vez só.
--
-- Nada muda no resultado: mesma consulta, só a ordem de execução. As outras
-- funções da tela (primeira_wo_tecnico, primeira_wo_grade) leem esta.

CREATE OR REPLACE FUNCTION public.primeira_wo_dia(p_de date, p_ate date, p_equipe text, p_buckets text[])
 RETURNS TABLE(tecnico_id uuid, nome text, equipe text, dia date, hora time without time zone, visita_id uuid, contrato text, grupo text, endereco text, minutos_depois integer, dentro boolean, turno text, meta time without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and ((select ve_cidade_inteira()) or v.equipe_id in (select equipes_visiveis()))
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
  janela_pri as materialized (
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
  turnos as materialized (
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
$function$;


notify pgrst, 'reload schema';
