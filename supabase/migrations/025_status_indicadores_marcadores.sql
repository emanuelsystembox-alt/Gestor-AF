-- 025 · Cadastro de situação, indicadores de qualidade e marcadores
--
-- Três coisas que o sistema atual tem e nós não tínhamos:
--
--   1. `situacao_visita` — a lista de status vira CADASTRO, com cor,
--      ícone e ordem. Até aqui a cor vivia no front-end
--      (`SITUACAO_INFO`), o que impedia a operação de ajustar sem
--      recompilar.
--
--   2. `indicador_qualidade` — AUTO INSPEÇÃO, BAIXA URA, BOTÃO ESCADA,
--      CERTIDÃO, GEOLOCALIZAÇÃO, O.S DIGITAL, URA DE INTERAÇÃO. Cada um
--      com meta e peso, e valendo para uma ou mais praças.
--
--   3. `visita_marcador` — o marcador que o analista põe no contrato,
--      apontando qual indicador foi cumprido (ou não).
--
-- ┌─ D-036 ─────────────────────────────────────────────────────────┐
-- │ `visita.situacao` continua `text` com CHECK, e NÃO virou FK.     │
-- │                                                                  │
-- │ O domínio de situação é ditado pelo TOA na importação; trocar    │
-- │ por FK faria o importador falhar em toda situação nova, em vez   │
-- │ de registrá-la. `situacao_visita` é a CAMADA DE APRESENTAÇÃO —   │
-- │ rótulo, cor, ícone, ordem — não a fonte da verdade.             │
-- │                                                                  │
-- │ O elo é conferido por um índice único no código, e a tela avisa  │
-- │ se aparecer situação sem cadastro, em vez de esconder.           │
-- └──────────────────────────────────────────────────────────────────┘

-- ---------- 1. situação como cadastro ----------
create table if not exists situacao_visita (
  codigo          text primary key,
  label           text not null,
  cor             text not null,              -- cor do texto/etiqueta
  cor_fundo       text,                       -- fundo da etiqueta
  icone           text,                       -- nome do ícone (front decide o desenho)
  ordem           smallint not null default 0,
  em_aberto       boolean not null default false,  -- ainda exige ação do COP
  terminal        boolean not null default false,  -- encerra o atendimento
  minutos_alerta  smallint,                   -- "Tempo" da tela deles
  ativo           boolean not null default true
);

insert into situacao_visita
  (codigo, label, cor, cor_fundo, icone, ordem, em_aberto, terminal) values
  ('ENTRADA',         'Na entrada',      '#3c8dbc', '#d9edf7', 'entrada',      1, true,  false),
  ('ATRIBUIDA',       'Atribuída',       '#6f7bd6', '#dfe2f7', 'atribuida',    2, true,  false),
  ('EM_DESLOCAMENTO', 'Em deslocamento', '#68838B', '#b1cfd8', 'deslocamento', 3, true,  false),
  ('EM_EXECUCAO',     'Em execução',     '#A9A9A9', '#d2d6d8', 'execucao',     4, true,  false),
  ('COM_IMPEDIMENTO', 'Com impedimento', '#D2691E', '#e3ad87', 'impedimento',  5, true,  false),
  ('REAGENDAMENTO',   'Reagendamento',   '#DAA520', '#ffe39f', 'reagendamento',6, false, false),
  ('CONCLUIDA',       'Concluída',       '#00a65a', '#dff0d8', 'concluida',    7, false, true),
  ('CANCELADA',       'Cancelada',       '#d33724', '#f0b9b2', 'cancelada',    8, false, true)
on conflict (codigo) do nothing;

alter table situacao_visita enable row level security;
create policy sv_leitura on situacao_visita for select to authenticated using (true);
create policy sv_escrita on situacao_visita for all to authenticated
  using (tem_papel('ADMIN')) with check (tem_papel('ADMIN'));

-- ---------- 2. indicadores de qualidade ----------
create table if not exists indicador_qualidade (
  id          uuid primary key default uuid_generate_v4(),
  empresa_id  uuid references empresa(id),
  nome        text not null,
  meta        numeric(10,2) not null default 100,
  peso        numeric(10,2) not null default 1,
  descricao   text,
  ordem       smallint not null default 0,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create unique index if not exists indicador_qualidade_nome_uk
  on indicador_qualidade (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), norm_txt(nome));

-- Em quais praças o indicador vale. Sem linha nenhuma = vale em todas.
create table if not exists indicador_qualidade_base (
  indicador_id uuid not null references indicador_qualidade(id) on delete cascade,
  base_id      uuid not null references base(id) on delete cascade,
  primary key (indicador_id, base_id)
);

alter table indicador_qualidade      enable row level security;
alter table indicador_qualidade_base enable row level security;

create policy iq_leitura on indicador_qualidade for select to authenticated
  using (empresa_id is null or empresa_id = minha_empresa());
create policy iq_escrita on indicador_qualidade for all to authenticated
  using (tem_papel('ADMIN')) with check (tem_papel('ADMIN'));

create policy iqb_leitura on indicador_qualidade_base for select to authenticated
  using (exists (select 1 from indicador_qualidade i
                  where i.id = indicador_id
                    and (i.empresa_id is null or i.empresa_id = minha_empresa())));
create policy iqb_escrita on indicador_qualidade_base for all to authenticated
  using (tem_papel('ADMIN')) with check (tem_papel('ADMIN'));

-- ---------- 3. marcador no contrato ----------
create table if not exists visita_marcador (
  id           uuid primary key default uuid_generate_v4(),
  visita_id    uuid not null references visita(id) on delete cascade,
  indicador_id uuid not null references indicador_qualidade(id),
  cumprido     boolean,                    -- null = apenas marcado, sem avaliação
  observacao   text,
  usuario_id   uuid references perfil(id),
  criado_em    timestamptz not null default now()
);
create unique index if not exists visita_marcador_uk
  on visita_marcador (visita_id, indicador_id);
create index if not exists visita_marcador_visita_ix on visita_marcador (visita_id);

alter table visita_marcador enable row level security;

-- Leitura acompanha a visita: quem enxerga a visita enxerga o marcador.
create policy vm_leitura on visita_marcador for select to authenticated
  using (exists (select 1 from visita v where v.id = visita_id));
-- Quem põe marcador é a gestão — é ela que avalia o contrato do técnico.
create policy vm_escrita on visita_marcador for all to authenticated
  using (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'))
  with check (eh_gestor() or tem_papel('CONTROLADOR') or tem_papel('SUPERVISOR'));

-- ---------- semente dos 7 indicadores da AFLINE ----------
insert into indicador_qualidade (empresa_id, nome, meta, peso, ordem)
select e.id, x.nome, 100, 1, x.ordem
  from empresa e,
       (values ('O.S DIGITAL', 1), ('BOTÃO ESCADA', 2), ('AUTO INSPEÇÃO', 3),
               ('URA DE INTERAÇÃO', 4), ('GEOLOCALIZAÇÃO', 5), ('CERTIDÃO', 6),
               ('BAIXA URA', 7)) as x(nome, ordem)
 where e.codigo = 'AFLINE'
on conflict do nothing;

-- Quem pôs o marcador é o banco que carimba, não o cliente: autoria de
-- avaliação não pode depender de o front-end lembrar de mandar o campo.
alter table visita_marcador alter column usuario_id set default auth.uid();
