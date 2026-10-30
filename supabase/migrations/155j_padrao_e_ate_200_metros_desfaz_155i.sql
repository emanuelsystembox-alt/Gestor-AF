-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155j · No padrão é ATÉ 200 m — desfaz a 155i                     ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "a regra e menor ou igual, nao exatamente abaixo, entendeu? Entao,
-- >  menor ou igual a 200 metros"  -- Emanuel, 29/10
--
-- A 155i tinha lido "abaixo de 200 metros" ao pe da letra e trocado
-- `>` por `>=`. A regra certa era a que ja estava: 200 m cravados e
-- DENTRO; fora e so acima de 200. Volta `dist > raio` = fora, nas duas
-- funcoes (local_da_baixa e monitor_tecnicos).
do $$
declare d text;
begin
  d := pg_get_functiondef('local_da_baixa(uuid[])'::regprocedure);
  d := replace(d, 'filter (where ev.dist >= r.m)', 'filter (where ev.dist > r.m)');
  d := replace(d, 'filter (where p.dist >= p.raio)', 'filter (where p.dist > p.raio)');
  d := replace(d, 'else t.dist >= t.raio end', 'else t.dist > t.raio end');
  if d ~ 'dist >= ' then
    raise exception 'local_da_baixa: ainda ha >=';
  end if;
  execute d;

  d := pg_get_functiondef('monitor_tecnicos(date)'::regprocedure);
  d := replace(d, 'v.lat::double precision, v.lng::double precision) >= v_raio)',
                  'v.lat::double precision, v.lng::double precision) > v_raio)');
  if d ~ '>= v_raio' then
    raise exception 'monitor_tecnicos: ainda ha >=';
  end if;
  execute d;
end $$;

revoke all on function local_da_baixa(uuid[]) from public, anon;
grant execute on function local_da_baixa(uuid[]) to authenticated;
revoke all on function monitor_tecnicos(date) from public, anon;
grant execute on function monitor_tecnicos(date) to authenticated;

notify pgrst, 'reload schema';
