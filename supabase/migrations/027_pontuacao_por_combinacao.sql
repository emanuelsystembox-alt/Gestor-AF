-- 027 · Pontuação por combinação de O.S.
--
-- ┌─ D-045 · A CHAVE DA PONTUAÇÃO É A COMBINAÇÃO DE O.S. ────────────┐
-- │ Medido no relatório mensal (17.987 linhas, 14.512 com pontuação):│
-- │                                                                  │
-- │   combinação × edificação × pessoa → 674 chaves, 94,2% estáveis  │
-- │   combinação × edificação          → 579 chaves, 94,1%  <- igual │
-- │   combinação × pessoa              → 527 chaves, 85,4%  <- pior  │
-- │                                                                  │
-- │   dos 105 combos presentes em CASA e APTO, 43 MUDAM (41%)        │
-- │   dos  43 combos presentes em FISICA e JURIDICA, 5 mudam (12%)   │
-- │                                                                  │
-- │ Exemplo: ADESAO - INSTALACAO DE ASSINATURA + ADESAO - INSTALAR   │
-- │ PONTO VIRTUA vale 1.4648 em CASA e 1.2925 em APTO — para pessoa  │
-- │ física E jurídica, o mesmo valor.                                │
-- │                                                                  │
-- │ EDIFICAÇÃO MANDA. TIPO DE PESSOA QUASE NÃO.                      │
-- │                                                                  │
-- │ Isso muda o bloqueio do 06-PONTUACAO: a dimensão que faltava na  │
-- │ nossa fonte (tipo de pessoa) é justamente a que menos importa. E │
-- │ edificação a gente lê do complemento do endereço em 60% dos      │
-- │ casos. O modelo aceita as duas, com 'QUALQUER' como coringa, e a │
-- │ regra mais específica sempre vence.                              │
-- └──────────────────────────────────────────────────────────────────┘
--
-- Semente: 546 combinações e 579 regras, direto do relatório de julho.
-- 34 regras nasceram marcadas "CONFERIR" (o relatório traz mais de um
-- valor para a mesma chave — provavelmente tabela de preço diferente).
-- Mais 448 regras coringa, para quando o endereço não diz se é casa ou
-- apartamento; elas copiam a regra de CASA, que é 72% da operação, e
-- dizem isso na observação.
--
-- Cobertura nos dois dias importados: 311 de 327 visitas produtivas,
-- 95,1%. Jornada não pontua, como esperado.

-- (DDL aplicado em 027; semente carregada pelo front com o usuário ADMIN,
--  para respeitar o RLS. Ver docs/06-PONTUACAO.md.)

create table if not exists tabela_preco (
  id         uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresa(id),
  nome       text not null,
  descricao  text,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table if not exists combinacao_os (
  id           uuid primary key default uuid_generate_v4(),
  empresa_id   uuid references empresa(id),
  assinatura   text not null,
  tipos        text[] not null,
  qtd_os       smallint not null,
  descricao    text,
  atendimentos integer not null default 0,
  criado_em    timestamptz not null default now()
);

create table if not exists regra_pontuacao (
  id              uuid primary key default uuid_generate_v4(),
  tabela_preco_id uuid not null references tabela_preco(id) on delete cascade,
  combinacao_id   uuid not null references combinacao_os(id) on delete cascade,
  edificacao      text not null default 'QUALQUER'
                  check (edificacao in ('CASA','APTO','COMERCIAL','QUALQUER')),
  tipo_pessoa     text not null default 'QUALQUER'
                  check (tipo_pessoa in ('FISICA','JURIDICA','QUALQUER')),
  pontos_claro    numeric(12,4),
  pontos_equipe   numeric(12,4),
  observacao      text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- D-018 manda recalcular retroativo; só é seguro se for reconstruível.
create table if not exists regra_pontuacao_log (
  id bigserial primary key, regra_id uuid, acao text not null,
  de jsonb, para jsonb, usuario_id uuid references perfil(id),
  criado_em timestamptz not null default now()
);

-- Funções: assinatura_da_visita, edificacao_da_visita, pontos_da_visita,
-- pontos_por_periodo. Ver o banco para o corpo consolidado (027b/027c).
