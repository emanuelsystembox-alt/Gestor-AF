-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 155i · No padrão é ABAIXO de 200 m                               ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- > "para a gente considerar uma geo no padrao, e abaixo de 200 metros
-- >  do raio"  -- Emanuel, 29/10
--
-- O raio ja era 200 (`raio_baixa_m`). A conta e que era "ate 200":
-- `dist > raio` = fora, entao 200 cravado contava como dentro. Passa a
-- ser estritamente abaixo -- `dist >= raio` = fora -- nas DUAS funcoes
-- que medem isso: `local_da_baixa` (a prova do contrato e o sino) e
-- `monitor_tecnicos` (o "baixas fora do raio" do Monitoramento). Uma
-- so mudando faria as duas telas discordarem justamente no limite.
--
-- >>> DESFEITA pela 155j, minutos depois: "a regra e menor ou igual,
-- >>> nao exatamente abaixo". Eu tinha lido "abaixo de 200" ao pe da
-- >>> letra e mudado uma regra que estava certa. Fica o arquivo porque
-- >>> a migration esta no historico do banco.
--
-- Aplicada no banco por substituicao sobre a definicao viva
-- (pg_get_functiondef + replace + execute), com conferencia de que
-- cada troca pegou. Os arquivos 155f e 155h voltaram ao `>` com a 155j.
do $$
declare d text;
begin
  d := pg_get_functiondef('local_da_baixa(uuid[])'::regprocedure);
  d := replace(d, 'filter (where ev.dist > r.m)', 'filter (where ev.dist >= r.m)');
  d := replace(d, 'filter (where p.dist > p.raio)', 'filter (where p.dist >= p.raio)');
  d := replace(d, 'else t.dist > t.raio end', 'else t.dist >= t.raio end');
  if d !~ 't\.dist >= t\.raio' or d !~ 'ev\.dist >= r\.m' or d !~ 'p\.dist >= p\.raio' then
    raise exception 'local_da_baixa: substituicao nao aplicou';
  end if;
  execute d;

  d := pg_get_functiondef('monitor_tecnicos(date)'::regprocedure);
  d := replace(d, 'v.lat::double precision, v.lng::double precision) > v_raio)',
                  'v.lat::double precision, v.lng::double precision) >= v_raio)');
  if d !~ '>= v_raio\)' then
    raise exception 'monitor_tecnicos: substituicao nao aplicou';
  end if;
  execute d;
end $$;

revoke all on function local_da_baixa(uuid[]) from public, anon;
grant execute on function local_da_baixa(uuid[]) to authenticated;
revoke all on function monitor_tecnicos(date) from public, anon;
grant execute on function monitor_tecnicos(date) to authenticated;

notify pgrst, 'reload schema';
