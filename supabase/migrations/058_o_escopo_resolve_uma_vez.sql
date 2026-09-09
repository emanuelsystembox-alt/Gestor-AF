-- 058 · O escopo resolve uma vez, não uma vez por linha
--
-- > *"pensa que esse sistema vai atender muitas pessoas... quero que
-- >  seja otimizado, sistema rápido sem travamento"* — Emanuel, 09/09
--
-- ┌─ O QUE FOI MEDIDO ───────────────────────────────────────────────┐
-- │ Como `authenticated` (nunca como dono — D-081), contando as 1.320 │
-- │ visitas do banco:                                                 │
-- │                                                                    │
-- │   RLS como estava .......... 121 ms                                │
-- │   escopo resolvido 1x ......  34 ms                                │
-- │                                                                    │
-- │ Três vezes e meia, com o banco ainda pequeno. O custo é LINEAR no  │
-- │ número de linhas: `minha_empresa()` e `eh_gestor()` escritos       │
-- │ soltos na policy são chamados **uma vez por linha avaliada**.      │
-- │                                                                    │
-- │ 45 das 86 policies chamavam `minha_empresa()` assim; 19 chamavam   │
-- │ `eh_gestor()`; 29, `tem_papel()`.                                  │
-- └────────────────────────────────────────────────────────────────────┘
--
-- A correção é a mesma ideia do D-081, agora do lado da policy:
-- `(select f())` em vez de `f()`. O planner resolve como **InitPlan** —
-- uma vez por consulta, não por linha. O resultado é idêntico: função
-- STABLE sem argumento da linha devolve o mesmo valor de qualquer jeito.
--
-- ┌─ POR QUE A REESCRITA É AUTOMÁTICA ───────────────────────────────┐
-- │ Reescrever 86 policies à mão é onde se abre buraco de segurança    │
-- │ sem perceber: um `AND` que vira `OR`, um paralelo que fecha no     │
-- │ lugar errado, e uma equipe passa a ver a de outra.                 │
-- │                                                                    │
-- │ Aqui a transformação é textual e mecânica, feita a partir do que   │
-- │ o próprio Postgres devolve em `pg_policies`, e a prova são as duas │
-- │ baterias — 16 + 14 cenários — rodadas depois.                      │
-- └────────────────────────────────────────────────────────────────────┘
--
-- A segunda troca é semântica e vale mais no futuro do que hoje:
--
--   visita_id IN (SELECT visita.id FROM visita)
--   →  EXISTS (SELECT 1 FROM visita v WHERE v.id = visita_id)
--
-- A primeira forma **materializa todas as visitas visíveis** para
-- decidir sobre UMA linha de evidência. Com 1.320 visitas ninguém sente;
-- com as ~70.000/ano que a operação gera (190/dia), toda leitura de
-- evidência, O.S. ou evento passaria por essa lista inteira. A forma
-- correlacionada usa a chave primária e para na primeira linha.
--
-- Ver D-118.

-- ============================================================
-- A · A transformação
-- ============================================================
create or replace function _envolve_escopo(p text) returns text
language sql immutable as $fn$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(
    coalesce(p,''),
    -- `IN (select id from visita)` → EXISTS correlacionado
    'visita_id IN \( SELECT visita\.id\s+FROM visita\)',
      'EXISTS (SELECT 1 FROM visita v WHERE v.id = visita_id)',       'g'),
    -- O `(?<!select )` deixa a migration idempotente — e o `i` no fim
    -- NÃO é detalhe. O Postgres devolve o sub-select na forma canônica
    -- DELE: `(select minha_empresa())` volta de `pg_policies` como
    -- `( SELECT minha_empresa() AS minha_empresa)`, com SELECT em
    -- MAIÚSCULA. Sem ignorar caixa, uma segunda passada envolveria tudo
    -- de novo — e foi exatamente isso que fez a primeira conferência
    -- acusar 53 policies "com função solta" que estavam corretas.
    '(?<!select )minha_empresa\(\)',      '(select minha_empresa())',  'gi'),
    '(?<!select )eh_gestor\(\)',          '(select eh_gestor())',      'gi'),
    '(?<!select )eh_global\(\)',          '(select eh_global())',      'gi'),
    '(?<!select )auth\.uid\(\)',          '(select auth.uid())',       'gi'),
    '(?<!select )(tem_papel|tem_permissao|meu_tecnico_id)\(([^()]*)\)',
                                          '(select \1(\2))',           'gi');
$fn$;

-- ============================================================
-- B · Reescreve toda policy que muda
-- ============================================================
do $$
declare
  r record; v_qual text; v_check text; v_sql text; n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, permissive, roles, cmd,
           qual, with_check
      from pg_policies
     where schemaname = 'public'
     order by tablename, policyname
  loop
    v_qual  := nullif(_envolve_escopo(r.qual), '');
    v_check := nullif(_envolve_escopo(r.with_check), '');

    -- Nada a fazer quando a transformação não muda nada.
    if coalesce(v_qual,'')  is not distinct from coalesce(r.qual,'')
       and coalesce(v_check,'') is not distinct from coalesce(r.with_check,'') then
      continue;
    end if;

    v_sql := format('create policy %I on public.%I as %s for %s to %s',
      r.policyname, r.tablename,
      case when r.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      lower(r.cmd),
      array_to_string(r.roles, ', '));

    if v_qual  is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute v_sql;
    n := n + 1;
  end loop;

  raise notice '% policies reescritas', n;
end $$;

drop function _envolve_escopo(text);

-- ============================================================
-- C · Conferência obrigatória
-- ============================================================
-- Rode as duas, e as duas TÊM de passar inteiras. É a única prova de
-- que a reescrita automática não afrouxou nada:
--
--   select * from testar_policies();   -- 16 cenários
--   select * from testar_campo();      -- 14 cenários
--
-- E confira que nenhuma policy ficou com função de escopo solta:
--
--   select tablename, policyname from pg_policies
--    where schemaname='public'
--      and (coalesce(qual,'')||' '||coalesce(with_check,''))
--          ~* '(?<!select )(minha_empresa|eh_gestor|eh_global)\(\)';
--   -- esperado: zero linhas   (`~*`, insensível a caixa — ver acima)
--
-- ============================================================
-- D · O que deu, medido depois
-- ============================================================
--   contar as 1.320 visitas como `authenticated`
--     antes .... 121 ms
--     depois ....  7 ms      → 17x
--   ordem_servico ....  5 ms
--   visita_evento ....  4 ms
--   policies com função solta: 0 de 86
--   testar_policies(): 16/16 · testar_campo(): 14/14
