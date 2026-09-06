-- ============================================================
-- 002 - Organizacao, pessoas e permissoes
-- D-002: login individual por tecnico
-- D-003: Monitor = Controlador. Hierarquia COP > Controlador
-- D-005: visita vai para a EQUIPE, com tecnico responsavel
-- ============================================================

-- ---------- Base operacional ----------
create table base (
  id      uuid primary key default uuid_generate_v4(),
  codigo  text not null unique,     -- 'MAN'
  nome    text not null,            -- 'Manaus - AM'
  uf      char(2) not null,
  ativo   boolean not null default true
);
insert into base (codigo, nome, uf) values ('MAN','Manaus - AM','AM');

-- ---------- Perfil do usuario (extensao de auth.users) ----------
create table perfil (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null,
  telefone    text,
  base_id     uuid references base(id),
  avatar_url  text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- ---------- Papeis ----------
-- escopo define SOBRE QUAIS REGISTROS o papel age.
-- Um usuario pode ter mais de um papel.
create type papel_tipo as enum
  ('ADMIN','COP','CONTROLADOR','SUPERVISOR','TECNICO','ALMOXARIFE','FROTA');

create type escopo_tipo as enum
  ('GLOBAL','BASE','AREA','CARTEIRA','EQUIPE','PROPRIO');

create table usuario_papel (
  id          uuid primary key default uuid_generate_v4(),
  usuario_id  uuid not null references perfil(id) on delete cascade,
  papel       papel_tipo not null,
  escopo      escopo_tipo not null,
  base_id     uuid references base(id),
  criado_em   timestamptz not null default now(),
  unique (usuario_id, papel)
);
create index on usuario_papel (usuario_id);

-- ---------- Equipe ----------
create table equipe (
  id             uuid primary key default uuid_generate_v4(),
  base_id        uuid not null references base(id),
  codigo         text not null,           -- '203'
  nome           text not null,           -- '203 - EQUIPE'
  area_id        uuid references area_trabalho(id),
  -- D-003: o Monitor do ngestor vira FK, nao texto livre (corrige D2)
  controlador_id uuid references perfil(id),
  ativo          boolean not null default true,
  unique (base_id, codigo)
);
create index on equipe (controlador_id);

-- ---------- Tecnico ----------
create table tecnico (
  id           uuid primary key default uuid_generate_v4(),
  base_id      uuid not null references base(id),
  usuario_id   uuid unique references perfil(id) on delete set null,
  matricula    text not null,             -- 'Z597207' (login TOA)
  toa_recurso_id text,                    -- 'ID do Recurso' do TOA: 59436
  nome         text not null,
  cpf          text,
  telefone     text,
  equipe_id    uuid references equipe(id),
  admissao     date,
  situacao     text not null default 'ATIVO'
               check (situacao in ('ATIVO','FERIAS','AFASTADO','DESLIGADO')),
  unique (base_id, matricula)
);
create index on tecnico (equipe_id);
create index on tecnico (usuario_id);
create unique index on tecnico (toa_recurso_id) where toa_recurso_id is not null;

-- ---------- Carteira do controlador ----------
-- D-003 confirmou Monitor = Controlador. A carteira e por EQUIPE
-- (equipe.controlador_id), mas esta tabela permite excecoes e
-- cobertura temporaria (ferias, folga) sem mexer no cadastro da equipe.
create table carteira (
  id             uuid primary key default uuid_generate_v4(),
  controlador_id uuid not null references perfil(id) on delete cascade,
  equipe_id      uuid not null references equipe(id) on delete cascade,
  inicio         date not null default current_date,
  fim            date,
  motivo         text,
  unique (controlador_id, equipe_id, inicio)
);
create index on carteira (equipe_id) where fim is null;

-- ============================================================
-- Funcoes auxiliares de permissao (usadas pelas policies em 005)
-- SECURITY DEFINER + search_path fixo: obrigatorio, senao a funcao
-- e barrada pelas proprias policies que ela alimenta.
-- ============================================================

create or replace function tem_papel(p papel_tipo)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from usuario_papel
    where usuario_id = auth.uid() and papel = p
  );
$fn$;

create or replace function eh_gestor()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from usuario_papel
    where usuario_id = auth.uid()
      and papel in ('ADMIN','COP')
  );
$fn$;

-- Equipes que o usuario logado enxerga.
-- ADMIN/COP: todas. CONTROLADOR: sua carteira. TECNICO: a propria.
create or replace function equipes_visiveis()
returns setof uuid language sql stable security definer set search_path = public as $fn$
  select e.id from equipe e where eh_gestor()
  union
  select c.equipe_id from carteira c
    where c.controlador_id = auth.uid()
      and c.inicio <= current_date
      and (c.fim is null or c.fim >= current_date)
  union
  select e.id from equipe e where e.controlador_id = auth.uid()
  union
  select t.equipe_id from tecnico t
    where t.usuario_id = auth.uid() and t.equipe_id is not null;
$fn$;

create or replace function meu_tecnico_id()
returns uuid language sql stable security definer set search_path = public as $fn$
  select id from tecnico where usuario_id = auth.uid() limit 1;
$fn$;
