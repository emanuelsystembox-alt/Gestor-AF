# Ferramentas e fluxo

Só o que está em uso de verdade neste projeto.

---

## O banco — Supabase self-hosted na VPS, via SSH

Desde **01/11/2026** o banco **não está mais no Supabase da nuvem**: o
projeto `kqfflkxjijzdtnfshdlv` foi **apagado**, e o **MCP do Supabase não
serve mais** (se aparecer conectado, aponta para o nada). O sistema roda no
Supabase instalado na VPS `erp.grupoafline.com` — ver `docs/12-VPS-ERP.md`.

| | |
|---|---|
| API (site, app, extensão) | `https://api.pulsoline.grupoafline.com.br` |
| SSH | `ssh root@179.197.82.110` (chave `~/.ssh/id_ed25519` da máquina do Emanuel) |
| Pasta | `/opt/supabase` · segredos em `/opt/supabase/.env` (`chmod 600`) |
| Banco | container `supabase-db`, Postgres 17 |
| **Backup** | **nenhum** — decisão do Emanuel. Antes de mexer em dado, saiba disso |

**Consultar** (o `postgres` daqui NÃO é superusuário, igual à nuvem —
`supabase_admin` é; use `postgres` para o trabalho normal):

```bash
ssh root@179.197.82.110 "docker exec supabase-db psql -U postgres -d postgres -c 'select count(*) from visita'"
```

**Migration** — o arquivo em `supabase/migrations/` é o registro; o banco é
o estado. Aplicar numa transação, parando no primeiro erro:

```bash
cat supabase/migrations/NNN_nome.sql | ssh root@179.197.82.110 "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction"
```

E depois, como sempre, `notify pgrst, 'reload schema';` e as duas baterias.

**Edge Function** — o código vai para
`/opt/supabase/volumes/functions/<nome>/` e se reinicia o container
`supabase-edge-functions` (`docker compose restart functions` em
`/opt/supabase`).

**Painéis visuais** (Studio, monitoramento, Portainer): só pelo túnel SSH —
o atalho `Paineis da VPS.bat` na Área de Trabalho do Emanuel abre tudo.

**Aspas e crases** em SQL passado pelo `ssh "…"` quebram no shell (ver
`traps.md`): SQL com aspas vai num arquivo, copiado com `scp` ou por
`cat arquivo | ssh … psql`.

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

**Extensão no Chromium da VPS** — o Chromium 24 h (container `navegador`, aberto pelo túnel em
`https://localhost:3001`) carrega a extensão de **`/opt/navegador/config/extensao-toa`**, uma CÓPIA:
`npm run extensao` só monta a pasta `extensao-toa/` daqui. Para atualizar (D-330):

```bash
cd extensao-toa
ssh root@179.197.82.110 "cp -a /opt/navegador/config/extensao-toa /opt/navegador/config/extensao-toa-bkp"
scp manifest.json fundo.js popup.js popup.html ponte.js toa.js toa-pagina.js portal-claro.js README.md root@179.197.82.110:/opt/navegador/config/extensao-toa/
ssh root@179.197.82.110 "chown 1000:1000 /opt/navegador/config/extensao-toa/*"
```

Depois, no Chromium da VPS: `chrome://extensions` → **↻** na extensão, F5 na aba do TOA e na do
Portal Técnico. Pelo seletor de pasta do "Carregar sem compactação" a pasta parece vazia — ele só
mostra pastas, não arquivos.

**Web** — deploy manual, e é fácil esquecer:

```powershell
cd app
npm run build
npx wrangler pages deploy dist --project-name=gestor-af --branch=main --commit-dirty=true
```

No ar em **pulsoline.grupoafline.com.br** (o `gestor-af.pages.dev`, nome do
projeto na Cloudflare, redireciona para ele — `app/functions/_middleware.js`). Confira que subiu baixando do ar e
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
$env:SUPABASE_URL = "https://api.pulsoline.grupoafline.com.br"
$env:SUPABASE_SERVICE_ROLE_KEY = "cole-aqui"   # SERVICE_ROLE_KEY de /opt/supabase/.env na VPS
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
