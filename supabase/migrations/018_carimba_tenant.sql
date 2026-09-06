-- A empresa nunca e digitada: deriva da base. Assim nenhum caminho de
-- insercao -- importador, tela, script -- consegue gravar sem tenant, e
-- ninguem precisa lembrar de preencher.
create or replace function carimba_empresa()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if new.empresa_id is null and new.base_id is not null then
    select empresa_id into new.empresa_id from base where id = new.base_id;
  end if;
  if new.empresa_id is null then
    new.empresa_id := minha_empresa();
  end if;
  return new;
end;
$fn$;

create trigger trg_visita_empresa      before insert on visita
  for each row execute function carimba_empresa();
create trigger trg_importacao_empresa  before insert on importacao
  for each row execute function carimba_empresa();
create trigger trg_equipe_empresa      before insert on equipe
  for each row execute function carimba_empresa();
create trigger trg_tecnico_empresa     before insert on tecnico
  for each row execute function carimba_empresa();
