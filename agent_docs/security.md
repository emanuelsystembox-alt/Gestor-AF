# Segurança

Stack real: **Supabase self-hosted na VPS (Postgres + PostgREST + Storage + Realtime)** —
desde 01/11/2026; a nuvem foi apagada. Porta de banco e painéis **só em 127.0.0.1**; para
fora, só as rotas da API, pelo Caddy (`docs/12-VPS-ERP.md`). **Não há backup.**
front web em Vite/React, aplicativo em Expo. Multi-tenant por
`empresa_id`, com escopo adicional por **base** (praça) e **equipe**.

---

## O princípio

**Permissão vive no banco. RLS no Postgres, não na tela.**

A tela esconde botão para não oferecer ação que vai falhar. Quem barra é
o banco. Se a interface for burlada, o Postgres simplesmente não devolve
a linha.

**Papel abre a sala; permissão diz o que se faz dentro** (D-055).
`usuario_papel` dá o papel (ADMIN, COP, CONTROLADOR, SUPERVISOR,
TECNICO…); `perfil_acesso` + `perfil_acesso_permissao` dão as chaves
finas (`servicos.baixar`, `servicos.anexar`, …). A permissão fina é
conferida nas **RPCs**, não nas 88 policies — decisão consciente: o
custo por linha não compensava.

---

## As duas baterias — rode antes de commitar

```sql
select * from testar_policies();   -- 35 cenários
select * from testar_campo();      -- 29 cenários
```

**As duas têm de passar inteiras.** A primeira prova o RLS; a segunda
prova as travas do campo (055), que **não são policy** — são guarda
dentro de função `SECURITY DEFINER`, que ignora RLS por definição.

**As duas são INVOKER de propósito.** Teste de policy escrito como
`SECURITY DEFINER` **não testa nada**: definer roda como o owner, que
tem `BYPASSRLS`, e todos os cenários passam sem o RLS ser consultado.
Use INVOKER + `set local role authenticated`. Ver D-054.

---

## Conferências obrigatórias depois de qualquer mudança

```sql
-- 1. nenhuma tabela sem RLS
select tablename from pg_tables t
join pg_class c on c.relname = t.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
where t.schemaname = 'public' and not c.relrowsecurity;
-- esperado: zero

-- 2. nenhuma SECURITY DEFINER alcançável pelo anon
select p.proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
-- esperado: zero

-- 3. depois de DDL, o PostgREST precisa saber
notify pgrst, 'reload schema';
```

---

## As armadilhas de segurança que já morderam

**`revoke ... from public` não remove concessão nominal.** O Supabase
concede `EXECUTE` explicitamente a `anon` em **toda** função criada no
schema `public`. Tem que ser `revoke ... from anon`. `CREATE OR REPLACE`
preserva a ACL, mas função criada do zero **nasce aberta de novo** —
inclusive função de **gatilho** (foi assim que `aviso_do_evento` escapou
na 059 e precisou da 061). Confira com `has_function_privilege`, **não
com o lint**, que demora a atualizar.

**Restaurar o dump num Supabase self-hosted abre as funções ao `anon`.** O
self-hosted dá `GRANT` automático (default privileges) a `anon`, `authenticated`
e `service_role` em todo objeto criado; o `pg_dump` só grava o que difere do
padrão do Postgres e não traz a retirada. No ensaio de 31/10 as **250
`SECURITY DEFINER` ficaram executáveis por quem não está logado** (na nuvem: 0)
— e as duas baterias não pegariam isso. Depois de qualquer restauração: a
conferência 2 abaixo, e `perm-conferir.sql` (ver `docs/12-VPS-ERP.md`).

**E as TABELAS também nascem abertas demais** (D-379). O padrão do `postgres` restaurado dava a
`anon` e `authenticated` TRUNCATE, TRIGGER, REFERENCES e MAINTAIN em toda tabela (107 de 112) — e o
RLS não vale para TRUNCATE. A 264 fechou e mudou o padrão; quem recriar o banco ou restaurar um dump
confere: `select count(*) from information_schema.role_table_grants where table_schema='public' and
grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')` — zero.

**`bases_visiveis()` é a cidade ATIVA, não todas as que a pessoa pode ver**
(103, D-180). O que ela PODE ver é `bases_permitidas()`: ADMIN todas;
os demais, `perfil.base_id` + `usuario_base`. O COP **não** é mais global.
Função que precise de "todas as cidades do usuário" usa `bases_permitidas()`;
a que filtra o que aparece na tela usa `bases_visiveis()`, como sempre.
`bases_visiveis()` **guarda a resposta na transação** (106, D-183), com o
usuário na chave; quem mudar base ou cidade ativa por fora de `trocar_cidade`
/ do gatilho do perfil tem de apagar `app.bases_visiveis`.

**`bases_visiveis()` honra o cabeçalho `x-afline-cidade`** (167, D-251). Com ele, a
resposta é aquela cidade — **só** se ela estiver em `bases_permitidas()`; qualquer outra
coisa (uuid de cidade que a pessoa não acessa, texto que não é uuid) dá **nenhuma**
cidade, nunca "cai" na ativa. É o mesmo poder de `trocar_cidade`, pedido a pedido: a
extensão usa para trabalhar em várias cidades sem mexer na tela de ninguém. O site não
manda. Testado como `authenticated` (7 casos, D-251). Quem mexer em `bases_visiveis()`
mantém isso — e a chave do cache da transação inclui o cabeçalho.

**O freio do login depende de `GOTRUE_RATE_LIMIT_HEADER`** (D-258). Nesta versão do GoTrue,
sem esse cabeçalho configurado **não há limite nenhum** de tentativas — o padrão do
self-hosted vem sem. Está em `/opt/supabase/docker-compose.afline.yml`
(`X-Forwarded-For`); o Caddy não confia em `X-Forwarded-For` vindo de fora, então não dá
para trocar de "IP" mandando o cabeçalho. Quem recriar a pilha confere:
`docker exec supabase-auth env | grep RATE_LIMIT_HEADER`.

**Subir evidência segue a mesma regra de registrá-la** (171, D-258): a policy
`evidencia_arquivo_enviar` chama `pode_anexar_na_visita(…, true)`. Mudou a regra do anexo?
Ela vale nos dois lugares sozinha — não reescreva a condição na policy.

**Login ↔ técnico só se liga dentro do escopo** (171 e `admin-usuarios`, D-258): o técnico
tem de ser da mesma empresa, de cidade que quem cadastra acessa, e sem outro login. O
gatilho `perfil_protege_campos` confere na edição; a função de borda, na criação.

**Decidido em 02/11 e fica assim** (D-258): SSH com senha e root (o Alisson entra assim);
senhas do lote sem troca obrigatória.

**`SECURITY DEFINER` ignora o RLS.** Se a função faz algo privilegiado,
cheque o papel **dentro** dela. Ver `importar_toa`, `baixar_os`.

**RLS não restringe COLUNA.** Policy de `UPDATE` liberada por linha
libera a linha inteira — inclusive as colunas que dão poder. Para
proteger coluna, o instrumento é **trigger**. Ver D-050.

**Policy do Storage que estoura vira negação em cima de tudo.**
`substring(name,1,36)::uuid` num objeto cujo nome não é UUID derruba a
policy inteira, **em silêncio**. Por isso existe `visita_do_path()`, com
`CASE`, que garante a ordem de avaliação. Ver D-116.

**Função de escopo solta na policy é chamada por linha** — e além de
lenta (121 ms → 7 ms), o custo é linear. Escreva
`(select minha_empresa())`. Ver D-118 e `traps.md`.

---

## Chaves e segredos

| chave | onde pode viver | o que faz |
|---|---|---|
| **publishable** (`sb_publishable_…`) | `.env` local, bundle do front, `eas.json` | nada sozinha — quem protege é o RLS |
| **service_role** | no `/opt/supabase/.env` da VPS (`chmod 600`, só root) — e, quando um script local precisar, na máquina do Emanuel em variável de ambiente, na hora do comando | ignora o RLS inteiro |

A `service_role` **nunca** entra no front, no `.env` do Vite (que vai
para o bundle), no Git, nem passa pelo assistente. É por isso que
`app/scripts/criar-usuarios-teste.mjs` é script, não tela.

`.env` está no `.gitignore` dos dois projetos. `.env.example` é
versionado e carrega só a publishable.

> No bundle publicado aparece o texto `sb_secret_` — é código da própria
> `supabase-js` conferindo prefixo de chave, **não** um segredo nosso.
> Uma busca ingênua por essa palavra assusta à toa.

---

## LGPD — dado de assinante

**Planilha de cliente não entra no Git.** `*.xlsx` e `*.csv` estão no
`.gitignore`. Nome, telefone e endereço de assinante são dado pessoal.

Não mande print com dado de assinante por WhatsApp ou e-mail — o link
com login existe para não precisar disso.

**O Realtime foi desenhado em cima disso** (D-119, D-120): publicamos
`aviso` e `visita_evento`, que são **magros** e não carregam nome,
telefone nem endereço. Publicar `visita` mandaria a linha inteira do
assinante pela rede a cada mudança.

**O bucket `evidencia` é privado.** A leitura passa por
`visita_do_path(name) in (select id from visita)` — o arquivo é visível
para exatamente quem já podia ver o contrato, sem uma segunda cópia da
regra de escopo para divergir da primeira.

---

## Antes de dar acesso a alguém

1. Crie o usuário em Administração → Novo usuário (senha aparece uma vez).
2. Escolha o perfil com cuidado: **COP e Controlador podem baixar,
   transferir e excluir contrato.** Ainda não existe perfil só-leitura.
3. Para o campo funcionar, o usuário precisa estar **vinculado a um
   técnico** (`tecnico.usuario_id`) de uma equipe com contrato.
