-- ============================================================================
-- 093 · Os pontos em conjunto
-- ============================================================================
-- Pendência da D-167: `pontos_da_visita` resolve UMA visita — três
-- subconsultas (assinatura, edificação, tipo de pessoa) e a busca da regra
-- entre as 1.021 ativas, por visita. Quem precisava do mês inteiro
-- (`produtividade_periodo`, o ranking, o painel, o ritmo) chamava a função
-- visita a visita, num `lateral`: ~0,5 ms cada, linear. Com um mês cheio,
-- segundos. > "pode rodar" — Emanuel, 27/09.
--
-- `pontos_das_visitas(uuid[])` faz a MESMA conta para o conjunto: a
-- assinatura de todas numa agregação, a regra por junção. A escolha da
-- regra é a mesma: tabela de preço ativa mais antiga, assinatura igual,
-- edificação e tipo de pessoa exatos ou QUALQUER, a mais precisa ganha.
--
-- ┌─ a edificação não foi copiada ────────────────────────────────────┐
-- │ A regra "APTO / COMERCIAL / CASA pelo complemento" morava dentro  │
-- │ de `edificacao_da_visita`. Copiá-la para a versão em conjunto     │
-- │ seria ter duas cópias para divergir no dia em que alguém ensinar  │
-- │ a regex a ler "CONJ". Ela vira `edificacao_de()`, e as duas       │
-- │ funções chamam a mesma.                                           │
-- └───────────────────────────────────────────────────────────────────┘
--
-- `pontos_da_visita` continua existindo: a tela do contrato mostra a
-- assinatura, a tabela e a regra que casou, e isso é por visita mesmo.
-- ============================================================================

create or replace function edificacao_de(p_tipo_residencia text, p_complemento text)
returns text language sql immutable set search_path to 'public' as $fn$
  select case
           when p_tipo_residencia is not null then p_tipo_residencia
           when upper(coalesce(p_complemento,'')) ~ '(^|[^A-Z])(APT|APTO|AP|BL|BLOCO|TOR|TORRE|COND|EDF|EDIF)([^A-Z]|$)' then 'APTO'
           when upper(coalesce(p_complemento,'')) ~ '(^|[^A-Z])(LJ|LOJA|SALA|SL|BOX|CJ|GALP)([^A-Z]|$)' then 'COMERCIAL'
           when upper(coalesce(p_complemento,'')) ~ '(^|[^A-Z])(CASA|CS|FD|FUNDO|ALT|ALTOS|QD|LT)([^A-Z]|$)' then 'CASA'
           else 'QUALQUER'
         end;
$fn$;
revoke all on function edificacao_de(text, text) from public, anon;
grant execute on function edificacao_de(text, text) to authenticated;

create or replace function edificacao_da_visita(p_visita uuid)
returns table (edificacao text, origem text)
language sql stable set search_path to 'public' as $fn$
  select edificacao_de(v.tipo_residencia, v.complemento),
         case
           when v.tipo_residencia is not null then 'CADASTRO'
           when coalesce(v.complemento,'') = '' then 'SEM COMPLEMENTO'
           else 'DERIVADA DO COMPLEMENTO'
         end
    from visita v where v.id = p_visita;
$fn$;

-- INVOKER, como `pontos_da_visita`: chamada pela tela, o RLS de `visita`
-- decide o que entra; chamada de dentro de uma DEFINER, quem chama já
-- filtrou o escopo.
create or replace function pontos_das_visitas(p_ids uuid[])
returns table (visita_id uuid, pontos_claro numeric, pontos_equipe numeric,
               edificacao text, achou boolean)
language sql stable set search_path to 'public' as $fn$
  with tp as materialized (
    select t.id from tabela_preco t where t.ativo order by t.criado_em limit 1
  ),
  v as materialized (
    select vi.id, vi.tipo_pessoa, edificacao_de(vi.tipo_residencia, vi.complemento) as edif
      from visita vi where vi.id = any(p_ids)
  ),
  a as materialized (
    select o.visita_id, string_agg(norm_txt(t.descricao), ' + ' order by o.sequencia) as assin
      from ordem_servico o
      join tipo_os t on t.id = o.tipo_os_id
     where o.visita_id = any(p_ids)
     group by o.visita_id
  ),
  r as materialized (
    select r.id, r.pontos_claro, r.pontos_equipe, r.edificacao, r.tipo_pessoa, c.assinatura
      from regra_pontuacao r
      join combinacao_os c on c.id = r.combinacao_id
      join tp on tp.id = r.tabela_preco_id
     where r.ativo
       and c.assinatura in (select assin from a)
  )
  select v.id, x.pontos_claro, x.pontos_equipe, v.edif, x.id is not null
    from v
    left join a on a.visita_id = v.id
    left join lateral (
      select r.id, r.pontos_claro, r.pontos_equipe from r
       where r.assinatura = a.assin
         and r.edificacao in (v.edif, 'QUALQUER')
         and r.tipo_pessoa in (coalesce(v.tipo_pessoa, 'QUALQUER'), 'QUALQUER')
       order by (r.edificacao <> 'QUALQUER')::int + (r.tipo_pessoa <> 'QUALQUER')::int desc
       limit 1
    ) x on true;
$fn$;
revoke all on function pontos_das_visitas(uuid[]) from public, anon;
grant execute on function pontos_das_visitas(uuid[]) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 093b · quem somava visita a visita passa a somar em conjunto
-- ============================================================================
-- Conferido ANTES de trocar: nas 240 visitas do banco, as duas versões
-- dão o mesmo resultado em todas (0 diferenças; 139 com regra nas duas),
-- e o tempo caiu de 142 ms para 11 ms.
--
-- `pontos_por_periodo` é o que Serviços, Equipes, Relatórios, o Painel do
-- dia e `produtividade_periodo` chamam — trocar só ela acelera as cinco.
-- Mesma assinatura. Uma diferença deliberada: sem tabela de preço ativa a
-- versão antiga SUMIA com a visita (cross join); agora a visita volta com
-- `achou = false` — "sem regra", e não fora da conta (D-117).
--
-- As três da 091 (`producao_por_tecnico`, `painel_do_tecnico`,
-- `ritmo_do_dia`) mudam só a origem dos pontos. O texto final delas está no
-- banco (aplicado como `093b_quem_soma_soma_em_conjunto`).

-- ============================================================================
-- 093c · a origem da edificação também em conjunto (aplicada em separado)
-- ============================================================================
-- Medido como `authenticated`: `pontos_por_periodo` levava 388 ms, porque
-- buscava a ORIGEM da edificação chamando `edificacao_da_visita` visita a
-- visita — e o RLS de `visita` pesava em cada busca. A regra da origem
-- virou `edificacao_origem()`, pura, usada pelos dois lados; a visita é
-- lida uma vez. 35 ms.
--
-- Resultado final, tudo como `authenticated`, 240 visitas, mesmos números
-- antes e depois (0 diferenças contra `pontos_da_visita`, inclusive
-- edificação e origem):
--   pontos_por_periodo   388 ms → 35 ms  (via tela: Serviços, Equipes…)
--   produtividade_periodo         23 ms
--   painel_do_tecnico    178 ms → 54 ms
--   ranking_tecnicos     111 ms → 17 ms
--   central_do_controle           21 ms
