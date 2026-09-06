-- Cadastro de equipes e tecnicos
--
-- Cuidado com a area: a planilha de equipes usa MA1..MA5, o TOA usa
-- MAN-AREA01..MAN-AREA05. Sao a mesma coisa com nomes diferentes.
-- O apelido guarda o de/para para o casamento nao depender de ninguem
-- lembrar disso.

alter table area_trabalho add column if not exists apelido text;
update area_trabalho set apelido = 'MA' || right(codigo, 1)
where codigo like 'MAN-AREA%';
create unique index if not exists area_apelido_uk on area_trabalho (apelido)
  where apelido is not null;

-- O supervisor vem como TEXTO da planilha ("SUPERVISOR - RAPHAEL FELIPE").
-- Guardamos o texto cru e o vinculo com o usuario quando ele existir --
-- corrige o defeito D2 sem travar a importacao em quem ainda nao tem conta.
alter table equipe
  add column if not exists supervisor_nome text,
  add column if not exists supervisor_id uuid references perfil(id),
  add column if not exists auto_router boolean,
  add column if not exists skills text;

create index if not exists equipe_supervisor_idx on equipe (supervisor_id);

-- Unifica as tres grafias da mesma pessoa:
-- "SUPERVISOR - X", "SUP. X" e "SUPERVISOR X".
create or replace function norm_supervisor(t text) returns text
language sql immutable set search_path = public, extensions as $fn$
  select nullif(btrim(regexp_replace(
    norm_txt(t), '^(SUPERVISOR|SUP\.?|SUPERV)\s*-?\s*', '')), '');
$fn$;

-- Quais grupos de servico cada equipe atende (fonte: Equipes.xlsx).
-- Habilita despacho por competencia em vez de por sorte.
create table if not exists equipe_tipo_servico (
  equipe_id       uuid not null references equipe(id) on delete cascade,
  tipo_servico_id uuid not null references tipo_servico(id) on delete cascade,
  primary key (equipe_id, tipo_servico_id)
);
alter table equipe_tipo_servico enable row level security;
create policy ets_leitura on equipe_tipo_servico for select
  to authenticated using (equipe_id in (select equipes_visiveis()));
create policy ets_escrita on equipe_tipo_servico for all
  to authenticated using (eh_gestor()) with check (eh_gestor());

-- NOTA: importar_equipes() e religar_visitas_equipe() nascem aqui mas sao
-- substituidas em 017 (tenant) e 021 (login da equipe). Ver a versao final
-- no banco ou rodar 'supabase db pull'.
