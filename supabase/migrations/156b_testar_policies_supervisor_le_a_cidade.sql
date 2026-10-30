-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 156b/c · A bateria ganha o supervisor da 156a                    ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- Tres cenarios novos em `testar_policies()` -- o supervisor LE a cidade
-- e NAO escreve:
--   · SUPERVISOR enxerga contratos da cidade       (mais de 0)
--   · SUPERVISOR muda a equipe do contrato direto  (0 linha)
--   · SUPERVISOR transfere contrato sem permissao  (barrado)
--
-- O update roda dentro de um bloco que SEMPRE desfaz (raise com a
-- contagem), para o teste nunca sujar dado mesmo se um dia a trava falhar.
--
-- 156c: as personas de teste passaram a nascer na CIDADE DO CONTRATO de
-- teste. Antes: base = "a primeira da tabela", visita = "qualquer uma"
-- -- podiam ser de cidades diferentes, e o cenario de leitura media o
-- vazio de uma cidade sem contrato (deu 0 na primeira rodada: era o
-- teste, nao a regra). Agora ler e tentar mexer sao sobre o MESMO
-- contrato. Resultado: 29/29 (26 antigos + 3).

-- ---- 156b ----
do $$
declare d text; novo text;
begin
  d := pg_get_functiondef('testar_policies()'::regprocedure);
  novo := $novo$
  -- 156a: o supervisor ve a cidade inteira, so olhando (Emanuel, 30/10).
  select count(*) into n from visita;
  return query select 'SUPERVISOR enxerga contratos da cidade'::text,'mais de 0'::text,n::text,n>0;

  begin
    begin
      update visita set equipe_id = (select e.id from equipe e
                                      where e.base_id = visita.base_id and e.id <> visita.equipe_id limit 1)
       where id = v_visita;
      get diagnostics n = row_count;
      raise exception 'desfaz:%', n;
    exception when others then
      if sqlerrm like 'desfaz:%' then n := substr(sqlerrm, 8)::int; else n := -1; end if;
    end;
    return query select 'SUPERVISOR muda a equipe do contrato direto'::text,'0 linha'::text,
      (case when n < 0 then 'barrado' else n::text||' linha' end), n <= 0;
  end;

  begin
    perform transferir_visita(v_visita, (select e.id from equipe e
                                           where e.base_id = v_base limit 1), 'teste');
    return query select 'SUPERVISOR transfere contrato (sem permissao)'::text,'barrado'::text,'*** PASSOU ***'::text,false;
  exception when others then
    return query select 'SUPERVISOR transfere contrato (sem permissao)'::text,'barrado'::text,'barrado'::text,true;
  end;

  -- ============ ROBO (111) ============$novo$;
  if strpos(d, '  -- ============ ROBO (111) ============') = 0 then
    raise exception 'ancora nao achada';
  end if;
  d := replace(d, '  -- ============ ROBO (111) ============', novo);
  execute d;
end $$;
revoke all on function testar_policies() from public, anon;

-- ---- 156c ----
do $$
declare d text;
begin
  d := pg_get_functiondef('_prepara_teste_policy()'::regprocedure);
  d := replace(d, '  select id into v_base from base limit 1;
  select v.id into visita from visita v where v.excluido_em is null limit 1;',
                  '  select v.id, v.base_id into visita, v_base from visita v
   where v.excluido_em is null and v.equipe_id is not null
     and exists (select 1 from equipe e where e.base_id = v.base_id and e.id <> v.equipe_id)
   limit 1;');
  if d !~ 'into visita, v_base' then raise exception 'troca nao pegou'; end if;
  execute d;
end $$;
revoke all on function _prepara_teste_policy() from public, anon;
