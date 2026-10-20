-- ┌─ 122 · toda visita com endereço tem edificação ─────────────────────┐
-- │ > "o que começa com TV é Beco, o que tiver LJ no complemento é      │
-- │ >  Loja, e o que tiver somente nome normal é casa (...) tem que     │
-- │ >  corrigir o nosso banco pra isso, para preencher todas as         │
-- │ >  edificações agora. use a sua inteligencia para identificar"      │
-- │ >  — Emanuel, 20/10, com a lista dos contratos sem edificação       │
-- │                                                                    │
-- │ A edificação não é gravada: `edificacao_de()` calcula na leitura,  │
-- │ a partir do cadastro (`tipo_residencia`) e do complemento (D-045).  │
-- │ Endereço sem complemento caía em QUALQUER — 627 visitas, das quais │
-- │ 274 com endereço (o resto é jornada). Agora a regra também lê o    │
-- │ LOGRADOURO, e corrigir a função corrige todos os contratos de uma  │
-- │ vez, os antigos e os que vierem.                                   │
-- │                                                                    │
-- │ A ordem (a primeira que casa vale):                                │
-- │  1. cadastro (`tipo_residencia`) — quem digitou manda;            │
-- │  2. sem logradouro e sem complemento → QUALQUER (jornada: não há  │
-- │     o que saber — zero e desconhecido não são a mesma coisa);     │
-- │  3. complemento de LOJA: LJ, LOJA, SALA, SL, BOX, GALP, ACAD, CJ  │
-- │     ("ED ALEGRO MALL, LJ 7" é loja, mesmo com "ED");              │
-- │  4. complemento de APTO: APT, AP, BL, BLC, BLOCO, TOR, COND, ED,  │
-- │     EDF, EDIF, COB, COBERTURA;                                     │
-- │  5. BECO: logradouro que começa com TV (pedido do Emanuel) ou BC  │
-- │     (a sigla do próprio beco: "BC CRAVARI"), ou que tem a palavra │
-- │     BECO ("R BECO SAO MARÇAL", complemento "BECOZURIQUE");        │
-- │  6. o resto é CASA — com sinal de casa no complemento (CASA, FD,  │
-- │     FT, F1, QD, LT, A, B…) ou sem sinal nenhum, que é o "nome     │
-- │     normal" da regra do Emanuel. A origem diz qual dos dois.      │
-- │                                                                    │
-- │ COMERCIAL vira LOJA (nenhum cadastro nem regra usava COMERCIAL).   │
-- │                                                                    │
-- │ NA PONTUAÇÃO, BECO É CASA. A CLARO só separa casa de apartamento   │
-- │ no preço (D-045), e beco é casa. Medido antes: sem isto, 13 que já │
-- │ eram CASA (rua TV/BC com "casa" no complemento) cairiam na coringa │
-- │ e 3 perderiam ponto. Regra própria de BECO, se um dia existir,     │
-- │ ganha da de CASA. LOJA segue na coringa, como o COMERCIAL seguia   │
-- │ (nenhum valor muda). As listas de Configurações aceitam os dois.   │
-- └────────────────────────────────────────────────────────────────────┘

-- ── o vocabulário ──
alter table visita drop constraint if exists visita_tipo_residencia_check;
alter table visita add constraint visita_tipo_residencia_check
  check (tipo_residencia in ('CASA', 'APTO', 'BECO', 'LOJA', 'OUTRO'));

alter table regra_pontuacao drop constraint if exists regra_pontuacao_edificacao_check;
alter table regra_pontuacao add constraint regra_pontuacao_edificacao_check
  check (edificacao in ('CASA', 'APTO', 'BECO', 'LOJA', 'QUALQUER'));

-- ── a regra: agora com o logradouro ──
create or replace function public.edificacao_de(p_tipo_residencia text, p_complemento text, p_logradouro text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
           when p_tipo_residencia is not null then p_tipo_residencia
           when btrim(coalesce(p_logradouro, '')) = '' and btrim(coalesce(p_complemento, '')) = '' then 'QUALQUER'
           when upper(coalesce(p_complemento, '')) ~ '(^|[^A-Z])(LJ|LOJA|LOJAS|SALA|SL|BOX|GALP|GALPAO|ACAD|ACADEMIA|CJ)([^A-Z]|$)' then 'LOJA'
           when upper(coalesce(p_complemento, '')) ~ '(^|[^A-Z])(APT|APTO|AP|BL|BLC|BLOCO|TOR|TORRE|COND|ED|EDF|EDIF|COB|COBERTURA)([^A-Z]|$)' then 'APTO'
           when upper(btrim(coalesce(p_logradouro, ''))) ~ '^(TV|BC)([^A-Z]|$)'
             or upper(coalesce(p_logradouro, '')) ~ '(^|[^A-Z])BECO([^A-Z]|$)'
             or upper(coalesce(p_complemento, '')) ~ 'BECO' then 'BECO'
           else 'CASA'
         end;
$function$;

create or replace function public.edificacao_origem(p_tipo_residencia text, p_complemento text, p_logradouro text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
           when p_tipo_residencia is not null then 'CADASTRO'
           when btrim(coalesce(p_logradouro, '')) = '' and btrim(coalesce(p_complemento, '')) = '' then 'SEM ENDERECO'
           when upper(coalesce(p_complemento, '')) ~ '(^|[^A-Z])(LJ|LOJA|LOJAS|SALA|SL|BOX|GALP|GALPAO|ACAD|ACADEMIA|CJ|APT|APTO|AP|BL|BLC|BLOCO|TOR|TORRE|COND|ED|EDF|EDIF|COB|COBERTURA)([^A-Z]|$)'
             then 'DERIVADA DO COMPLEMENTO'
           when upper(btrim(coalesce(p_logradouro, ''))) ~ '^(TV|BC)([^A-Z]|$)'
             or upper(coalesce(p_logradouro, '')) ~ '(^|[^A-Z])BECO([^A-Z]|$)' then 'DERIVADA DO LOGRADOURO'
           when upper(coalesce(p_complemento, '')) ~ 'BECO' then 'DERIVADA DO COMPLEMENTO'
           when upper(coalesce(p_complemento, '')) ~ '(^|[^A-Z])(CASA|CS|FD|FUNDO|FUNDOS|FT|FRENTE|F[0-9]+|ALT|ALTOS|QD|LT|TERREO)([^A-Z]|$)'
             then 'DERIVADA DO COMPLEMENTO'
           else 'SEM INDICACAO (CASA)'
         end;
$function$;

revoke all on function public.edificacao_de(text, text, text) from public, anon;
revoke all on function public.edificacao_origem(text, text, text) from public, anon;
grant execute on function public.edificacao_de(text, text, text) to authenticated, service_role;
grant execute on function public.edificacao_origem(text, text, text) to authenticated, service_role;

-- ── quem chamava a de 2 argumentos (lidas do banco, não dos arquivos — traps.md) ──
create or replace function public.edificacao_da_visita(p_visita uuid)
 returns table(edificacao text, origem text)
 language sql
 stable
 set search_path to 'public'
as $function$
  select edificacao_de(v.tipo_residencia, v.complemento, v.logradouro),
         edificacao_origem(v.tipo_residencia, v.complemento, v.logradouro)
    from visita v where v.id = p_visita;
$function$;

create or replace function public.pontos_das_visitas(p_ids uuid[])
 returns table(visita_id uuid, pontos_claro numeric, pontos_equipe numeric, edificacao text, achou boolean)
 language sql
 stable
 set search_path to 'public'
as $function$
  with tp as materialized (
    select t.id from tabela_preco t where t.ativo order by t.criado_em limit 1
  ),
  v as materialized (
    select vi.id, vi.tipo_pessoa, edificacao_de(vi.tipo_residencia, vi.complemento, vi.logradouro) as edif
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
         and r.edificacao in (v.edif, case v.edif when 'BECO' then 'CASA' end, 'QUALQUER')
         and r.tipo_pessoa in (coalesce(v.tipo_pessoa, 'QUALQUER'), 'QUALQUER')
       -- a própria edificação > CASA (para o BECO) > coringa; depois o tipo de pessoa
       order by case r.edificacao when v.edif then 2 when 'QUALQUER' then 0 else 1 end desc,
                (r.tipo_pessoa <> 'QUALQUER')::int desc
       limit 1
    ) x on true;
$function$;

create or replace function public.pontos_da_visita(p_visita uuid, p_tabela uuid default null)
 returns table(pontos_claro numeric, pontos_equipe numeric, assinatura text, edificacao text, edificacao_de text, tabela text, regra_id uuid, achou boolean)
 language sql
 stable
 set search_path to 'public'
as $function$
with v as (
  select assinatura_da_visita(p_visita) as assin,
         (select e.edificacao from edificacao_da_visita(p_visita) e) as edif,
         (select e.origem     from edificacao_da_visita(p_visita) e) as edif_de,
         (select vi.tipo_pessoa from visita vi where vi.id = p_visita) as pessoa
),
tp as (
  select t.id, t.nome from tabela_preco t
   where t.ativo and (p_tabela is null or t.id = p_tabela)
   order by (t.id = p_tabela) desc, t.criado_em limit 1
),
achada as (
  select r.pontos_claro, r.pontos_equipe, r.id as regra_id
    from regra_pontuacao r
    join combinacao_os c on c.id = r.combinacao_id
    cross join v cross join tp
   where r.ativo and r.tabela_preco_id = tp.id
     and c.assinatura = v.assin
     and r.edificacao  in (v.edif, case v.edif when 'BECO' then 'CASA' end, 'QUALQUER')
     and r.tipo_pessoa in (coalesce(v.pessoa, 'QUALQUER'), 'QUALQUER')
   -- 122: a própria edificação > CASA (para o BECO) > coringa; depois o tipo de pessoa
   order by case r.edificacao when v.edif then 2 when 'QUALQUER' then 0 else 1 end desc,
            (r.tipo_pessoa <> 'QUALQUER')::int desc
   limit 1
)
select a.pontos_claro, a.pontos_equipe, v.assin, v.edif, v.edif_de,
       tp.nome, a.regra_id, a.regra_id is not null
  from v cross join tp left join achada a on true;
$function$;

create or replace function public.pontos_por_periodo(p_de date, p_ate date)
 returns table(visita_id uuid, pontos_claro numeric, pontos_equipe numeric, edificacao text, edificacao_de text, achou boolean)
 language sql
 stable
 set search_path to 'public'
as $function$
  with vs as materialized (
    select v.id, v.tipo_residencia, v.complemento, v.logradouro from visita v
     where v.data_agendada between p_de and p_ate
       and v.excluido_em is null
  )
  select p.visita_id, p.pontos_claro, p.pontos_equipe, p.edificacao,
         edificacao_origem(vs.tipo_residencia, vs.complemento, vs.logradouro),
         p.achou
    from vs join pontos_das_visitas(array(select id from vs)) p on p.visita_id = vs.id;
$function$;

-- a de 2 argumentos sai: ficar com as duas é convite a alguém chamar a velha
drop function if exists public.edificacao_de(text, text);
drop function if exists public.edificacao_origem(text, text);

notify pgrst, 'reload schema';
