-- A "fila" e o tempo entre a atividade ser ATRIBUIDA no TOA e o tecnico
-- iniciar. Calcular a partir de visita.criado_em esta errado: criado_em e
-- a hora da IMPORTACAO, entao uma planilha subida no fim do dia daria
-- fila de zero (ou negativa) para tudo.
--
-- O TOA traz o instante certo em 'Tempo de Atribuicao da Atividade'
-- (formato DD/MM/YY HH24:MI). Guardamos em coluna propria.
--
-- Nao mexo em importar_toa_interno: um trigger extrai de dados_origem,
-- o que tambem corrige as linhas ja importadas.

alter table visita
  add column if not exists toa_atribuido_em timestamptz;

create or replace function extrai_atribuicao()
returns trigger language plpgsql set search_path = public as $fn$
declare v text;
begin
  v := new.dados_origem ->> 'Tempo de Atribuição da Atividade';
  if v is not null and btrim(v) <> '' then
    begin
      new.toa_atribuido_em :=
        to_timestamp(btrim(v), 'DD/MM/YY HH24:MI') at time zone 'America/Manaus';
    exception when others then
      new.toa_atribuido_em := null;   -- formato inesperado nao derruba a carga
    end;
  end if;
  return new;
end;
$fn$;

create trigger trg_visita_atribuicao
  before insert or update of dados_origem on visita
  for each row execute function extrai_atribuicao();

-- backfill das linhas ja carregadas
update visita set dados_origem = dados_origem
where dados_origem ? 'Tempo de Atribuição da Atividade';

create index if not exists visita_atribuido_idx on visita (toa_atribuido_em);
