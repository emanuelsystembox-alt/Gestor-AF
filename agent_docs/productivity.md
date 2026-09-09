# Ferramentas e fluxo

Só o que está em uso de verdade neste projeto.

---

## Supabase — via MCP, não pelo painel

O MCP do Supabase está conectado nesta sessão. É por ele que se aplica
migration, se consulta o banco e se investiga. **Projeto:**
`kqfflkxjijzdtnfshdlv` · **organização:** AFLINE Manager · **plano:
Free**.

```
apply_migration   DDL, sempre
execute_sql       consulta e investigação
get_advisors      lint de segurança/desempenho
```

**Migrations rodam em ordem**, pelo MCP ou pelo SQL Editor. O arquivo em
`supabase/migrations/` é o registro; o banco é o estado.

**Para testar como outro papel** (a única forma honesta — ver
`security.md`):

```sql
perform set_config('request.jwt.claims',
  json_build_object('sub', <uuid>, 'role','authenticated')::text, true);
execute 'set local role authenticated';
-- ...
execute 'reset role';
```

Envolver num `do $$ … raise exception … $$` faz o teste **rolar para
trás** — bom para experimentar sem sujar produção. Cuidado: transação
desfeita **não** dispara Realtime.

---

## Publicar

**Web** — deploy manual, e é fácil esquecer:

```powershell
cd app
npm run build
npx wrangler pages deploy dist --project-name=gestor-af --branch=main --commit-dirty=true
```

No ar em **gestor-af.pages.dev**. Confira que subiu baixando do ar e
comparando com o local — o "Success" do Wrangler só diz que o upload
terminou. Detalhes em `docs/09-PUBLICAR.md`.

**Aplicativo** — no dia a dia, Expo Go (instantâneo):

```powershell
cd campo
npx expo start
```

Celular e computador na mesma rede; senão, `npx expo start --tunnel`.

Para gerar APK (projeto EAS já ligado —
`@afline-instalacao-e-manutencao-eletrica/afline-manager`):

```powershell
cd campo
npx eas-cli@latest build --platform android --profile preview
```

Fila do plano gratuito chega a passar de uma hora; a compilação em si
leva ~12 min. iPhone exige conta paga Apple (US$ 99/ano).

---

## Conferir antes de terminar

```powershell
cd app
npx tsc --noEmit
npm run build
```

```powershell
cd campo
npx tsc --noEmit
npx expo export --platform android --output-dir ../.tmp-export
```

O `expo export` é o teste de bundle: pega import quebrado e módulo
nativo faltando, que o `tsc` não vê.

E, para qualquer mudança em RLS, papel ou permissão, as duas baterias
(`security.md`).

---

## Scripts do projeto

**`app/scripts/criar-usuarios-teste.mjs`** — cria os logins de teste
(controlador, supervisor, técnico), vinculados a dado real. Exige a
`service_role`, que **só o Emanuel** manuseia:

```powershell
cd app
$env:SUPABASE_URL = "https://kqfflkxjijzdtnfshdlv.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "cole-aqui"
node scripts/criar-usuarios-teste.mjs
```

Idempotente. `--remover` desfaz; `--resetar-senha` troca as senhas.
O técnico de teste é escolhido **pelo dado** — aquele cuja equipe tem
mais contrato em aberto hoje —, porque matrícula fixa apodrece quando a
escala do TOA muda.

---

## Git

`gh` disponível para PR e issue. Branch principal: `main`.

Mensagem de commit: **título curto no imperativo, e o corpo explicando
o PORQUÊ** — inclusive o que foi medido e o que ficou por verificar.
O histórico deste repositório é usado como documentação; escreva para
quem vai ler daqui a seis meses.

---

## Terminal

**Windows PowerShell 5.1.** Não tem `&&` — uma linha por comando, ou
`;`. Ver `traps.md`.
