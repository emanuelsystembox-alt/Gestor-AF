-- ============================================================
-- 001 - Dominios (tabelas de referencia)
-- Extraidos dos dados reais de 04/09/2026.
-- Regra: nada de texto livre onde existe codigo. Corrige o defeito D1
-- (409 - Servico Concluido vs 409 - SERVICO CONCLUIDO contados separados).
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "unaccent";

-- Normalizador usado na importacao para casar texto sujo da planilha
create or replace function norm_txt(t text) returns text
  language sql immutable as $fn$
    select upper(trim(regexp_replace(unaccent(coalesce(t,'')), '\s+', ' ', 'g')))
  $fn$;

-- ---------- Area de trabalho (MAN-AREA01..05) ----------
create table area_trabalho (
  id          uuid primary key default uuid_generate_v4(),
  codigo      text not null unique,          -- 'MAN-AREA05'
  nome        text,
  ativo       boolean not null default true
);
insert into area_trabalho (codigo) values
  ('MAN-AREA01'), ('MAN-AREA02'), ('MAN-AREA03'), ('MAN-AREA04'), ('MAN-AREA05');

-- ---------- Tipo de atividade (a natureza da visita) ----------
-- Separa servico a cliente de apontamento de jornada.
-- Sem isso, "Refeicao" (47/dia) entra no calculo de produtividade.
create table tipo_atividade (
  id          uuid primary key default uuid_generate_v4(),
  nome        text not null unique,
  natureza    text not null check (natureza in ('PRODUTIVA','JORNADA')),
  ativo       boolean not null default true
);

insert into tipo_atividade (nome, natureza) values
  ('Instalacao','PRODUTIVA'), ('Visita Tecnica','PRODUTIVA'),
  ('Mudanca de Endereco','PRODUTIVA'), ('INST GPON - INST CABO','PRODUTIVA'),
  ('Mudanca de Pacote','PRODUTIVA'), ('Troca Decoder Digital','PRODUTIVA'),
  ('Mudanca de Local','PRODUTIVA'), ('Reinstalacao','PRODUTIVA'),
  ('Manut Drop','PRODUTIVA'), ('Manut Ruido','PRODUTIVA'),
  ('Retorno Credenciada','PRODUTIVA'), ('Modernizacao','PRODUTIVA'),
  ('Instalacao Streaming Express','PRODUTIVA'),
  ('Mud Pacote Streaming Express','PRODUTIVA'),
  ('INST HFC - INST CABO','PRODUTIVA'), ('Refazer Manutencao PON','PRODUTIVA'),
  ('Na Base','JORNADA'), ('Refeicao','JORNADA'),
  ('Apoio a outro tecnico','JORNADA'), ('Manutencao do Veiculo','JORNADA');

-- ---------- Tipo de servico (agrupador do ngestor) ----------
create table tipo_servico (
  id     uuid primary key default uuid_generate_v4(),
  nome   text not null unique,
  ativo  boolean not null default true
);
insert into tipo_servico (nome) values
  ('VISITA TECNICA'), ('ADESAO'), ('DESCONEXAO'), ('SERVICO'),
  ('MIGRACAO GPON'), ('MUDANCA DE ENDERECO'), ('RETORNO DE CREDENCIADA'),
  ('REINSTALACAO');

-- ---------- Tipo de O.S. (codigo numerico da CLARO) ----------
create table tipo_os (
  id         uuid primary key default uuid_generate_v4(),
  codigo     integer not null unique,        -- 1, 43, 191, 511...
  descricao  text not null,
  ativo      boolean not null default true
);
insert into tipo_os (codigo, descricao) values
  (1,'ADESAO - INSTALACAO DE ASSINATURA'), (4,'RETIRAR PONTO'),
  (12,'MUDANCA DE ENDERECO - INSTALAR ASSINATURA'), (15,'MUDANCA DE LOCAL DE PONTO'),
  (24,'MUDANCA DE PACOTE'), (43,'ADESAO - INSTALAR PONTO VIRTUA'),
  (44,'INSTALAR PONTO VIRTUA'),
  (45,'MUDANCA DE ENDERECO - INSTALAR PONTO ADICIONAL VIRTUA'),
  (46,'REINSTALACAO - PONTO ADICIONAL VIRTUA'), (48,'VISITA TECNICA - VIRTUA'),
  (51,'ADESAO - INSTALACAO DE ASSINATURA DIGITAL'),
  (52,'ADESAO - INSTALAR SERVICO CONEXAO ADICIONAL DIGITAL'),
  (54,'MUDANCA DE ENDERECO - INSTALAR ASSINATURA DIGITAL'),
  (57,'MUDANCA DE PACOTE DIGITAL'), (62,'VISITA TECNICA DIGITAL'),
  (69,'RETORNO DE CREDENCIADA'), (101,'ADESAO - INSTALAR PONTO PORTABILIDADE'),
  (129,'MANUTENCAO REPARO NO DROP'), (148,'TROCA DECODER PARA ATUALIZACAO DIGITAL'),
  (156,'INSTALACAO WIFI MESH'), (191,'INSTALACAO DE CABO GPON'),
  (208,'ENVIO DE CHIP VIA TECNICO'), (307,'LIMPEZA DE RUIDO INDOOR'),
  (510,'BASE ENTREGA STREAMING'), (511,'MUD PACOTE ENTREGA STREAMING'),
  (512,'REINSTALACAO ENTREGA STREAMING'), (516,'ADESAO ENTREGA STREAMING'),
  (517,'ADESAO ENTREGA ADC STREAMING');

-- Codigo de baixa: ver 002_codigo_baixa.sql (166 codigos + classificacao)

-- ---------- Segmentacao e capacidade ----------
create table segmentacao (
  id uuid primary key default uuid_generate_v4(),
  nome text not null unique,
  prioridade smallint not null default 5
);
insert into segmentacao (nome, prioridade) values
  ('BLACK',1), ('PURPLE',2), ('PURPLE PME PF',2), ('PURPLE INTERNET',2),
  ('PME',3), ('WHITE',4), ('BSOD',4), ('SEM SEGMENTO',5);

create table categoria_capacidade (
  id uuid primary key default uuid_generate_v4(),
  nome text not null unique
);
insert into categoria_capacidade (nome) values
  ('Classe 1'), ('Classe 1 (PME)'), ('Classe 3'), ('Classe 4'),
  ('Classe 5'), ('Classe 5 (PME)'), ('Classe 14'), ('Classe 15');
