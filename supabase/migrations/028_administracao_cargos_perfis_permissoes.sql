-- 028 · Administração: cargos, perfis de acesso e permissões
--
-- ┌─ D-049 · PAPEL É A BARREIRA; PERMISSÃO É A GRANULARIDADE ────────┐
-- │ As 66 policies do banco decidem por PAPEL (`tem_papel`). Isso    │
-- │ NÃO muda aqui. Reescrever 66 policies para consultar permissão   │
-- │ fina numa sessão só é o jeito de abrir buraco sem perceber.      │
-- │                                                                  │
-- │ `tem_permissao()` é camada ADICIONAL, checada nas RPCs e na      │
-- │ tela. Ela restringe, nunca amplia: quem não tem o papel não      │
-- │ passa da RLS, mesmo com a permissão marcada.                     │
-- │                                                                  │
-- │ ADMIN passa em tudo, por definição — senão o primeiro admin se   │
-- │ trancaria para fora ao criar o primeiro perfil de acesso.        │
-- └──────────────────────────────────────────────────────────────────┘
--
-- ┌─ D-050 · AUTOEDIÇÃO NÃO PODE MUDAR O QUE DÁ PODER ──────────────┐
-- │ A policy `perfil_autoedicao` (migration 005) libera UPDATE onde  │
-- │ `id = auth.uid()` — para a pessoa arrumar o próprio telefone.    │
-- │ Só que RLS não restringe COLUNA: com ela, qualquer usuário podia │
-- │ trocar o próprio `perfil_acesso_id` e se dar todas as permissões,│
-- │ ou mudar `empresa_id` e enxergar outra credenciada.              │
-- │                                                                  │
-- │ Passou despercebido por 27 migrations porque só existia um       │
-- │ usuário, e ele era ADMIN. Viraria buraco no dia em que o         │
-- │ primeiro técnico logasse.                                        │
-- │                                                                  │
-- │ O trigger `perfil_protege_campos` barra o que dá poder; o resto  │
-- │ segue livre. Conexão de serviço (auth.uid() nulo) passa: ela já  │
-- │ pode tudo pela porta da frente.                                  │
-- └──────────────────────────────────────────────────────────────────┘
--
-- ┌─ D-051 · CRIAR LOGIN PASSA POR EDGE FUNCTION ────────────────────┐
-- │ Criar conta em `auth.users` exige a service_role, que NUNCA pode │
-- │ ir para o navegador. A função `admin-usuarios` guarda a chave no │
-- │ servidor e só age depois de conferir, COM O JWT de quem chamou e │
-- │ consultando o banco, que a pessoa é ADMIN.                       │
-- │                                                                  │
-- │ A senha é gerada no servidor e devolvida uma vez, para o admin   │
-- │ repassar. Nada de senha em texto no banco.                       │
-- │                                                                  │
-- │ Se o INSERT do perfil falhar, a função desfaz o usuário do auth  │
-- │ — acesso órfão em `auth.users` é login sem dono.                 │
-- └──────────────────────────────────────────────────────────────────┘
--
-- ┌─ D-052 · `usuario_papel.escopo` É OBRIGATÓRIO E NÃO TEM DEFAULT ─┐
-- │ A primeira versão de `definir_papeis` não passava escopo. O      │
-- │ insert morria em not-null e o usuário nascia SEM PAPEL NENHUM —  │
-- │ um login que entra e não enxerga nada, sem erro visível.         │
-- │                                                                  │
-- │ Escopo padrão por papel (`escopo_padrao`), coerente com o que já │
-- │ estava gravado:                                                  │
-- │   ADMIN, COP  → GLOBAL                                           │
-- │   TECNICO     → PROPRIO                                          │
-- │   demais      → BASE (a base do próprio perfil)                  │
-- └──────────────────────────────────────────────────────────────────┘

create table if not exists cargo (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresa(id),
  nome text not null, descricao text,
  ordem smallint not null default 0, ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists perfil_acesso (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid references empresa(id),
  nome text not null, descricao text,
  papel papel_tipo,             -- o que a RLS enxerga (D-049)
  ordem smallint not null default 0, ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists permissao (
  chave text primary key, modulo text not null, rotulo text not null,
  descricao text, ordem smallint not null default 0,
  disponivel boolean not null default true   -- false = módulo ainda não existe
);

create table if not exists perfil_acesso_permissao (
  perfil_acesso_id uuid not null references perfil_acesso(id) on delete cascade,
  permissao_chave  text not null references permissao(chave) on delete cascade,
  primary key (perfil_acesso_id, permissao_chave)
);

alter table perfil
  add column if not exists apelido text,
  add column if not exists cpf text,
  add column if not exists rg text,
  add column if not exists data_nascimento date,
  add column if not exists whatsapp text,
  add column if not exists matricula_ponto text,
  add column if not exists login_field text,
  add column if not exists cargo_id uuid references cargo(id),
  add column if not exists perfil_acesso_id uuid references perfil_acesso(id),
  add column if not exists tecnico_id uuid references tecnico(id),
  add column if not exists atualizado_em timestamptz not null default now();

-- RLS: leitura por empresa, escrita só ADMIN. `permissao` é catálogo:
-- todo mundo lê, ninguém escreve pela aplicação.
-- Funções: tem_permissao, minhas_permissoes, definir_papeis,
-- definir_situacao_usuario, escopo_padrao, perfil_protege_campos.
-- Ver o banco para o corpo consolidado (028b a 028e).
--
-- Semente: 10 cargos, 6 perfis de acesso (um por papel) e 26 permissões
-- em 8 módulos — os 5 que existem e 3 reservados (almoxarifado,
-- financeiro, frota), marcados `disponivel = false`.
