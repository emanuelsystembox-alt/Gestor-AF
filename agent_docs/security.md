# Segurança

Stack real: **Supabase (Postgres + PostgREST + Storage + Realtime)**,
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
select * from testar_policies();   -- 16 cenários
select * from testar_campo();      -- 14 cenários
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
| **service_role** | **só** na máquina do Emanuel, em variável de ambiente, na hora do comando | ignora o RLS inteiro |

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
