-- Helpers de leitura do JSONB da planilha do TOA.
-- Todos toleram formato inesperado devolvendo null, para que uma celula
-- estranha nao derrube a carga inteira.

create or replace function j_txt(d jsonb, k text) returns text
language sql immutable as $fn$
  select nullif(btrim(coalesce(d ->> k, '')), '');
$fn$;

create or replace function j_data(d jsonb, k text) returns date
language plpgsql immutable as $fn$
declare v text := j_txt(d, k);
begin
  if v is null then return null; end if;
  return to_date(v, 'DD/MM/YY');
exception when others then return null;
end;
$fn$;

create or replace function j_hora(d jsonb, k text, ponta int default 1)
returns time language plpgsql immutable as $fn$
declare v text := j_txt(d, k); p text[];
begin
  if v is null then return null; end if;
  p := regexp_split_to_array(v, '\s*-\s*');
  if array_length(p,1) < ponta then return null; end if;
  return (btrim(p[ponta]))::time;
exception when others then return null;
end;
$fn$;

create or replace function j_num(d jsonb, k text) returns numeric
language plpgsql immutable as $fn$
declare v text := j_txt(d, k);
begin
  if v is null then return null; end if;
  return replace(v, ',', '.')::numeric;
exception when others then return null;
end;
$fn$;

-- combina 'Data' + hora no fuso de Manaus -> timestamptz
create or replace function j_ts(d jsonb, k_data text, k_hora text)
returns timestamptz language plpgsql immutable as $fn$
declare dt date := j_data(d, k_data); hr time := j_hora(d, k_hora, 1);
begin
  if dt is null or hr is null then return null; end if;
  return (dt + hr) at time zone 'America/Manaus';
exception when others then return null;
end;
$fn$;

create or replace function j_interv(d jsonb, k text) returns interval
language plpgsql immutable as $fn$
declare v text := j_txt(d, k);
begin
  if v is null then return null; end if;
  return v::interval;
exception when others then return null;
end;
$fn$;

-- 'NNN - DESCRICAO' -> NNN. Resolve o defeito de caixa inconsistente
-- (409 - Servico Concluido vs 409 - SERVICO CONCLUIDO) e as variantes
-- com sufixo (203 - Rede Externa Com Problema - REAGENDADO).
create or replace function extrai_codigo(v text) returns integer
language plpgsql immutable as $fn$
declare m text;
begin
  if v is null then return null; end if;
  m := substring(btrim(v) from '^(\d+)');
  if m is null then return null; end if;
  return m::integer;
exception when others then return null;
end;
$fn$;

create or replace function situacao_do_toa(v text) returns text
language sql immutable as $fn$
  select case norm_txt(v)
    when 'CONCLUIDO'     then 'CONCLUIDA'
    when 'INICIADO'      then 'EM_EXECUCAO'
    when 'EM ROTA'       then 'EM_DESLOCAMENTO'
    when 'CANCELADO'     then 'CANCELADA'
    when 'PENDENTE'      then 'ENTRADA'
    when 'NAO CONCLUIDO' then 'COM_IMPEDIMENTO'
    when 'SUSPENSO'      then 'COM_IMPEDIMENTO'
    else 'ENTRADA'
  end;
$fn$;
