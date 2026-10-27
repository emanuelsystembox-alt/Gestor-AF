-- 149 · O PAINEL da Qualidade: producao por analista e indicadores
--
-- > "depois mostrar um grafico do mes, qual e o login que esta ativando"
-- > "melhore as visoes" -- Emanuel, 26/10
--
-- Cinco leituras, cada uma numa funcao, todas sobre o MESMO conjunto
-- (`qualidade_fila`) -- uma regra num lugar so, para o card e a tabela
-- nunca divergirem, que e a licao da D-150.
--
--   qualidade_indicadores  os seis cartoes do topo
--   qualidade_por_analista quem ligou, quanto, e se bateu a meta
--   qualidade_meta_dia     a grade analista x dia
--   qualidade_por_grupo    ranking por equipe e por tipo de servico
--   qualidade_observacoes  o que o assinante falou, nas palavras dele
--
-- COBERTURA e sobre a fila (o que da para avaliar), nao sobre o total de
-- visitas: contrato que ninguem foi atender nao e cobertura perdida.
--
-- NAO EXISTE card de NPS: a nota e de 1 a 5 por decisao do Emanuel, e
-- NPS so e definido em 0-10. No lugar vai SATISFACAO = % de notas 4 e 5.
--
-- Ver D-229.

-- ====================================================================
-- 1 · os cartoes
-- ====================================================================
create or replace function public.qualidade_indicadores(p_de date, p_ate date)
returns table(
  na_fila integer, avaliados integer, pendentes integer,
  contatados integer, conclusivos integer,
  normalizado integer, problemas integer, rede_externa integer,
  pct_cobertura numeric, pct_contato numeric, pct_conformidade numeric,
  nota_media numeric, com_nota integer, pct_satisfacao numeric,
  reclamacao_conduta integer, com_observacao integer)
language sql stable security definer
set search_path to 'public'
as $function$
  with f as (select * from qualidade_fila(p_de, p_ate))
  select count(*)::int,
         count(desfecho)::int,
         count(*) filter (where desfecho is null)::int,
         count(*) filter (where qualidade_contatado(desfecho))::int,
         count(*) filter (where qualidade_conclusivo(desfecho))::int,
         count(*) filter (where desfecho = 'NORMALIZADO')::int,
         -- PROBLEMA e veredito conclusivo que nao foi normalizado. Rede
         -- externa fica de fora: e planta da CLARO, nao execucao nossa.
         count(*) filter (where qualidade_conclusivo(desfecho)
                            and desfecho <> 'NORMALIZADO')::int,
         count(*) filter (where desfecho = 'REDE_EXTERNA')::int,
         -- Zero e desconhecido nao sao a mesma coisa: sem denominador o
         -- percentual e NULO, nunca 0 (regra 6).
         case when count(*) > 0
              then round(100.0 * count(desfecho) / count(*), 1) end,
         case when count(desfecho) > 0
              then round(100.0 * count(*) filter (where qualidade_contatado(desfecho))
                         / count(desfecho), 1) end,
         case when count(*) filter (where qualidade_conclusivo(desfecho)) > 0
              then round(100.0 * count(*) filter (where desfecho = 'NORMALIZADO')
                         / count(*) filter (where qualidade_conclusivo(desfecho)), 1) end,
         round(avg(nota_tecnico) filter (where nota_tecnico is not null), 2),
         count(nota_tecnico)::int,
         case when count(nota_tecnico) > 0
              then round(100.0 * count(*) filter (where nota_tecnico >= 4)
                         / count(nota_tecnico), 1) end,
         count(*) filter (where tratou_bem is false)::int,
         count(*) filter (where observacao is not null and btrim(observacao) <> '')::int
    from f;
$function$;

-- ====================================================================
-- 2 · producao por analista
-- ====================================================================
create or replace function public.qualidade_por_analista(p_de date, p_ate date)
returns table(
  usuario_id uuid, analista text, hoje integer, meta_diaria integer,
  avaliados integer, dias integer, media_dia numeric,
  dias_na_meta integer, contatados integer, problemas integer,
  pct_conformidade numeric, nota_media numeric, ultima timestamptz)
language sql stable security definer
set search_path to 'public'
as $function$
  with meta as materialized (
    select coalesce((select (valor #>> '{}')::int from parametro
                      where empresa_id = minha_empresa() and chave = 'qualidade_meta_diaria'),
                    70) as n
  ),
  -- A producao e contada pelo DIA EM QUE SE LIGOU (`registrado_em`, em
  -- Manaus), nao pelo dia do contrato: o analista trabalha hoje a fila
  -- de ontem, e a meta dele e do dia dele.
  base as (
    select q.usuario_id,
           (q.registrado_em at time zone 'America/Manaus')::date as dia,
           q.desfecho, q.nota_tecnico, q.registrado_em
      from pesquisa_qualidade q
     where q.empresa_id = minha_empresa()
       and q.base_id in (select bases_visiveis())
       and (q.registrado_em at time zone 'America/Manaus')::date between p_de and p_ate
       and (select tem_permissao('qualidade.ver'))
  ),
  por_dia as (
    select usuario_id, dia, count(*)::int as n from base group by 1, 2
  )
  select b.usuario_id,
         coalesce(p.nome, 'Sem nome'),
         coalesce((select d.n from por_dia d
                    where d.usuario_id = b.usuario_id and d.dia = hoje_local()), 0),
         m.n,
         count(*)::int,
         count(distinct b.dia)::int,
         round(count(*)::numeric / nullif(count(distinct b.dia), 0), 1),
         (select count(*) from por_dia d
           where d.usuario_id = b.usuario_id and d.n >= m.n)::int,
         count(*) filter (where qualidade_contatado(b.desfecho))::int,
         count(*) filter (where qualidade_conclusivo(b.desfecho)
                            and b.desfecho <> 'NORMALIZADO')::int,
         case when count(*) filter (where qualidade_conclusivo(b.desfecho)) > 0
              then round(100.0 * count(*) filter (where b.desfecho = 'NORMALIZADO')
                         / count(*) filter (where qualidade_conclusivo(b.desfecho)), 1) end,
         round(avg(b.nota_tecnico) filter (where b.nota_tecnico is not null), 2),
         max(b.registrado_em)
    from base b
    cross join meta m
    left join perfil p on p.id = b.usuario_id
   group by b.usuario_id, p.nome, m.n
   order by count(*) desc;
$function$;

-- ====================================================================
-- 3 · a grade analista x dia
-- ====================================================================
create or replace function public.qualidade_meta_dia(p_de date, p_ate date)
returns table(usuario_id uuid, analista text, dia date,
              quantos integer, meta_diaria integer, na_meta boolean)
language sql stable security definer
set search_path to 'public'
as $function$
  with meta as materialized (
    select coalesce((select (valor #>> '{}')::int from parametro
                      where empresa_id = minha_empresa() and chave = 'qualidade_meta_diaria'),
                    70) as n
  )
  select q.usuario_id, coalesce(p.nome, 'Sem nome'),
         (q.registrado_em at time zone 'America/Manaus')::date,
         count(*)::int, m.n, count(*) >= m.n
    from pesquisa_qualidade q
    cross join meta m
    left join perfil p on p.id = q.usuario_id
   where q.empresa_id = minha_empresa()
     and q.base_id in (select bases_visiveis())
     and (q.registrado_em at time zone 'America/Manaus')::date between p_de and p_ate
     and (select tem_permissao('qualidade.ver'))
   group by q.usuario_id, p.nome, 3, m.n
   order by 2, 3;
$function$;

-- ====================================================================
-- 4 · ranking por equipe e por tipo de servico
-- ====================================================================
create or replace function public.qualidade_por_grupo(p_de date, p_ate date, p_eixo text)
returns table(operacao text, chave text, avaliados integer, problemas integer,
              pct_conformidade numeric, nota_media numeric)
language sql stable security definer
set search_path to 'public'
as $function$
  with f as (select * from qualidade_fila(p_de, p_ate) where desfecho is not null)
  select case when p_eixo = 'EQUIPE' then max(f.operacao) end,
         case when p_eixo = 'EQUIPE' then coalesce(f.equipe, 'sem equipe')
              else coalesce(f.grupo, 'sem grupo') end,
         count(*)::int,
         count(*) filter (where qualidade_conclusivo(f.desfecho)
                            and f.desfecho <> 'NORMALIZADO')::int,
         case when count(*) filter (where qualidade_conclusivo(f.desfecho)) > 0
              then round(100.0 * count(*) filter (where f.desfecho = 'NORMALIZADO')
                         / count(*) filter (where qualidade_conclusivo(f.desfecho)), 1) end,
         round(avg(f.nota_tecnico) filter (where f.nota_tecnico is not null), 1)
    from f
   group by 2
   order by count(*) filter (where qualidade_conclusivo(f.desfecho)
                               and f.desfecho <> 'NORMALIZADO') desc,
            count(*) desc;
$function$;

-- ====================================================================
-- 5 · as observacoes, nas palavras do assinante
-- ====================================================================
create or replace function public.qualidade_observacoes(p_de date, p_ate date)
returns table(visita_id uuid, contrato text, dia date, desfecho text,
              operacao text, equipe text, grupo text, analista text,
              observacao text, registrado_em timestamptz)
language sql stable security definer
set search_path to 'public'
as $function$
  select f.visita_id, f.contrato, f.data_agendada, f.desfecho,
         f.operacao, f.equipe, f.grupo, f.analista, f.observacao, f.registrado_em
    from qualidade_fila(p_de, p_ate) f
   where f.observacao is not null and btrim(f.observacao) <> ''
   order by f.registrado_em desc;
$function$;

revoke all on function public.qualidade_indicadores(date, date)     from public, anon;
revoke all on function public.qualidade_por_analista(date, date)    from public, anon;
revoke all on function public.qualidade_meta_dia(date, date)        from public, anon;
revoke all on function public.qualidade_por_grupo(date, date, text) from public, anon;
revoke all on function public.qualidade_observacoes(date, date)     from public, anon;
grant execute on function public.qualidade_indicadores(date, date)     to authenticated, service_role;
grant execute on function public.qualidade_por_analista(date, date)    to authenticated, service_role;
grant execute on function public.qualidade_meta_dia(date, date)        to authenticated, service_role;
grant execute on function public.qualidade_por_grupo(date, date, text) to authenticated, service_role;
grant execute on function public.qualidade_observacoes(date, date)     to authenticated, service_role;

notify pgrst, 'reload schema';
