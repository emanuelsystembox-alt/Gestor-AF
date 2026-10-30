-- 158c: a bateria ganha o defeito da 158b -- o controlador SEM carteira
-- (que e todo controlador do sistema: `carteira` tem 0 linhas) le a
-- cidade. Antes da 158b este cenario daria 0.
do $$
declare d text; novo text;
begin
  d := pg_get_functiondef('testar_policies()'::regprocedure);
  novo := $novo$
  -- 158b: toda a gestao ve a cidade; o controlador nao depende de carteira.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ctrl::text,'role','authenticated')::text, true);
  select count(*) into n from visita;
  return query select 'CONTROLADOR sem carteira enxerga a cidade'::text,'mais de 0'::text,n::text,n>0;

  -- ============ ROBO (111) ============$novo$;
  if strpos(d, '  -- ============ ROBO (111) ============') = 0 then raise exception 'ancora'; end if;
  d := replace(d, '  -- ============ ROBO (111) ============', novo);
  execute d;
end $$;
revoke all on function testar_policies() from public, anon;
