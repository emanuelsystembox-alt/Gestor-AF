-- ============================================================
-- 003 - Nucleo: Visita -> Ordem de Servico -> Execucao
-- D-001: a unidade de trabalho e a VISITA; ela contem 1..N O.S.
-- D-006: em conflito com o TOA, o dado do campo vence
-- ============================================================

-- ---------- Importacao ----------
-- D-004: o arquivo sobe varias vezes ao dia. Guardamos SEMPRE o
-- original e a linha crua. Nada se perde na transformacao.
create table importacao (
  id             uuid primary key default uuid_generate_v4(),
  base_id        uuid not null references base(id),
  usuario_id     uuid references perfil(id),
  arquivo_nome   text not null,
  arquivo_path   text not null,            -- Supabase Storage
  arquivo_hash   text,                     -- detecta reenvio do mesmo arquivo
  fonte          text not null default 'TOA' check (fonte in ('TOA','NGESTOR','MANUAL')),
  status         text not null default 'PROCESSANDO'
                 check (status in ('PROCESSANDO','PREVIA','APLICADA','CANCELADA','ERRO')),
  total_linhas   integer default 0,
  qtd_criadas    integer default 0,
  qtd_atualizadas integer default 0,
  qtd_ignoradas  integer default 0,
  qtd_erro       integer default 0,
  qtd_conflito   integer default 0,
  criado_em      timestamptz not null default now(),
  aplicado_em    timestamptz
);
create index on importacao (base_id, criado_em desc);

create table importacao_linha (
  id             uuid primary key default uuid_generate_v4(),
  importacao_id  uuid not null references importacao(id) on delete cascade,
  numero_linha   integer not null,
  dados          jsonb not null,           -- a linha crua, intacta
  resultado      text check (resultado in ('CRIADA','ATUALIZADA','IGNORADA','ERRO','CONFLITO')),
  mensagem       text,
  visita_id      uuid
);
create index on importacao_linha (importacao_id, resultado);

-- ---------- VISITA (a "Atividade" do TOA) ----------
create table visita (
  id                uuid primary key default uuid_generate_v4(),
  base_id           uuid not null references base(id),

  -- Chave de upsert (D-004). Vem de 'ID da Atividade' do TOA.
  toa_atividade_id  text,
  origem            text not null default 'TOA' check (origem in ('TOA','MANUAL')),

  -- Identificacao CLARO
  wo_numero         text,                  -- 'Numero da WO'
  contrato          text,

  -- Classificacao
  tipo_atividade_id uuid references tipo_atividade(id),
  tipo_servico_id   uuid references tipo_servico(id),
  segmentacao_id    uuid references segmentacao(id),
  categoria_id      uuid references categoria_capacidade(id),
  area_id           uuid references area_trabalho(id),
  node              text,
  workzone_key      text,

  -- Cliente (dado cadastral: o TOA pode atualizar)
  cliente_nome      text,
  tipo_pessoa       text check (tipo_pessoa in ('FISICA','JURIDICA')),
  telefones         text[],
  tipo_residencia   text check (tipo_residencia in ('CASA','APTO','COMERCIAL','OUTRO')),

  -- Endereco
  logradouro        text,
  complemento       text,
  bairro            text,
  cidade            text,
  uf                char(2),
  cep               text,
  lat               numeric(10,7),
  lng               numeric(10,7),
  codigo_ibge       text,

  -- Agendamento
  data_agendada     date not null,
  janela_inicio     time,
  janela_fim        time,

  -- Atribuicao (D-005)
  equipe_id             uuid references equipe(id),
  tecnico_responsavel_id uuid references tecnico(id),
  controlador_id        uuid references perfil(id),

  -- Estado (maquina de estados real do ngestor, ver 01-MAPEAMENTO)
  situacao          text not null default 'ENTRADA'
                    check (situacao in ('ENTRADA','ATRIBUIDA','EM_DESLOCAMENTO',
                                        'EM_EXECUCAO','CONCLUIDA','CANCELADA',
                                        'REAGENDAMENTO','COM_IMPEDIMENTO')),
  situacao_em       timestamptz,

  -- Execucao em campo
  inicio            timestamptz,
  fim               timestamptz,
  tempo_deslocamento interval,
  observacao        text,

  -- D-006: trava de protecao.
  -- Marcado no primeiro registro vindo do campo. A partir dai a
  -- importacao TOA so pode tocar campos cadastrais.
  bloqueado_em      timestamptz,

  -- Rastreabilidade
  importacao_id     uuid references importacao(id),
  dados_origem      jsonb,

  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create unique index visita_toa_uk on visita (base_id, toa_atividade_id)
  where toa_atividade_id is not null;
create index on visita (data_agendada, equipe_id);
create index on visita (equipe_id, situacao);
create index on visita (controlador_id, data_agendada);
create index on visita (situacao) where situacao not in ('CONCLUIDA','CANCELADA');

-- ---------- ORDEM DE SERVICO (1..10 por visita) ----------
create table ordem_servico (
  id             uuid primary key default uuid_generate_v4(),
  visita_id      uuid not null references visita(id) on delete cascade,
  sequencia      smallint not null,          -- 1..10, a posicao na planilha

  numero_os      text not null,              -- '2607495696'
  ponto          text,                       -- '34660865'
  tipo_os_id     uuid references tipo_os(id),

  -- Status que a OPERADORA reconhece
  status_operadora text check (status_operadora in ('EXECUTADA','NAO_EXECUTADA')),
  codigo_baixa_id  uuid references codigo_baixa(id),

  produto        text,
  observacao     text,

  criado_em      timestamptz not null default now(),
  unique (visita_id, sequencia)
);
create unique index on ordem_servico (numero_os);
create index on ordem_servico (visita_id);
create index on ordem_servico (codigo_baixa_id);

-- ---------- Reincidencia ----------
-- Substitui as colunas SERVICO-ANTERIOR-* do ngestor por um vinculo real.
-- D-007: o tecnico PODE ver isto.
create table reincidencia (
  id                uuid primary key default uuid_generate_v4(),
  visita_id         uuid not null references visita(id) on delete cascade,
  visita_anterior_id uuid references visita(id),
  dias_desde        integer,
  equipe_anterior_id uuid references equipe(id),
  codigo_baixa_anterior_id uuid references codigo_baixa(id),
  detectado_em      timestamptz not null default now(),
  unique (visita_id)
);

-- ---------- Evidencias (fotos) ----------
create table evidencia (
  id           uuid primary key default uuid_generate_v4(),
  visita_id    uuid not null references visita(id) on delete cascade,
  os_id        uuid references ordem_servico(id) on delete cascade,
  tipo         text not null,     -- GEOLOCALIZACAO, CLIENTE_AUSENTE, NR35,
                                  -- TUBULACAO, MEDICAO_SINAL, URA, LIVRE
  arquivo_path text not null,
  tamanho_bytes bigint,
  lat          numeric(10,7),
  lng          numeric(10,7),
  capturada_em timestamptz,
  tecnico_id   uuid references tecnico(id),
  criado_em    timestamptz not null default now()
);
create index on evidencia (visita_id);

-- ---------- Equipamentos movimentados ----------
create table equipamento_movimento (
  id          uuid primary key default uuid_generate_v4(),
  visita_id   uuid not null references visita(id) on delete cascade,
  os_id       uuid references ordem_servico(id) on delete set null,
  operacao    text not null check (operacao in ('INSTALADO','RETIRADO')),
  serial      text not null,
  tipo        text,               -- EMTA, DECODER DIGITAL, ONT...
  modelo      text,
  tecnico_id  uuid references tecnico(id),
  criado_em   timestamptz not null default now()
);
create index on equipamento_movimento (serial);
create index on equipamento_movimento (visita_id);

-- ---------- Trilha de auditoria (imutavel) ----------
create table visita_evento (
  id          bigserial primary key,
  visita_id   uuid not null references visita(id) on delete cascade,
  usuario_id  uuid references perfil(id),
  tecnico_id  uuid references tecnico(id),
  tipo        text not null,      -- IMPORTADA, ATRIBUIDA, CHECKIN, BAIXA,
                                  -- REAGENDADA, CANCELADA, CONFLITO_TOA...
  de          jsonb,
  para        jsonb,
  lat         numeric(10,7),
  lng         numeric(10,7),
  origem      text,               -- WEB, MOBILE, IMPORTACAO, SISTEMA
  criado_em   timestamptz not null default now()
);
create index on visita_evento (visita_id, criado_em desc);

-- ============================================================
-- D-006 na pratica: trava de protecao
-- ============================================================

-- Assim que a visita sai de ENTRADA/ATRIBUIDA por acao do campo,
-- ela fica bloqueada para sobrescrita pela importacao.
create or replace function marca_bloqueio()
returns trigger language plpgsql as $fn$
begin
  if new.bloqueado_em is null
     and new.situacao in ('EM_DESLOCAMENTO','EM_EXECUCAO','CONCLUIDA',
                          'REAGENDAMENTO','COM_IMPEDIMENTO') then
    new.bloqueado_em := now();
  end if;
  new.atualizado_em := now();
  return new;
end;
$fn$;

create trigger trg_visita_bloqueio
  before insert or update on visita
  for each row execute function marca_bloqueio();

-- Lista dos campos que a importacao TOA PODE atualizar mesmo apos bloqueio.
-- Tudo que nao esta aqui e territorio do campo.
create or replace function campos_cadastrais() returns text[]
language sql immutable as $fn$
  select array[
    'cliente_nome','tipo_pessoa','telefones','tipo_residencia',
    'logradouro','complemento','bairro','cidade','uf','cep',
    'lat','lng','codigo_ibge','contrato','wo_numero',
    'segmentacao_id','categoria_id','area_id','node','workzone_key',
    'data_agendada','janela_inicio','janela_fim'
  ];
$fn$;

comment on column visita.bloqueado_em is
  'D-006: quando preenchido, a importacao TOA so pode alterar os campos '
  'listados em campos_cadastrais(). Status, baixa, fotos, materiais e '
  'observacao passam a ser exclusivos do campo.';
