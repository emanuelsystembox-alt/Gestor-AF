# Conexões, MCPs e chaves — o que uma IA nova herda

Levantado em **02/11/2026**. Este arquivo diz **onde** cada credencial mora e **como conferir**
que está viva. **Nenhum valor secreto está aqui, nem pode estar** — o repositório vai para o
GitHub (regra de ouro 3 e `agent_docs/security.md`).

> **Para outra IA (Claude Code) que vai trabalhar neste projeto:** abrindo esta pasta **no
> computador do Emanuel, no usuário `Emanu` do Windows**, você já entra com tudo conectado —
> as credenciais moram no perfil do usuário, não no projeto. Não reconecte nada. Rode a
> conferência e comece:
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\conferir-conexoes.ps1
> ```
>
> Se algum item vier ❌, é aquele item que precisa de atenção — o resto está pronto.

---

## 1. Os MCPs

| MCP (nome na sessão) | De onde vem | Onde está a credencial | Estado 02/11 | Para que serve aqui |
|---|---|---|---|---|
| `hostinger-api` | servidor local (stdio), `npx hostinger-api-mcp@3.22.3` | `~/.claude.json` → `mcpServers.hostinger-api.env.API_TOKEN` | ✔ conectado | a VPS `erp` (id **2098432**): backups, Docker, firewall, reinício. **A `gestao.gruporainhaisabel.com` não é para mexer.** |
| `plugin:expo:expo` | plugin `expo@claude-plugins-official` | OAuth do plugin (guardado pelo Claude Code) | ✔ conectado | EAS: builds, updates, logs do app `campo/` |
| `plugin:hostinger:hostinger` | plugin `hostinger@claude-plugins-official` | OAuth — **nunca autenticado** | ! precisa `/mcp` | não usado: o `hostinger-api` já cobre a VPS |
| `plugin:lovable:lovable` | plugin `lovable@claude-plugins-official` | OAuth — **nunca autenticado** | ! precisa `/mcp` | não usado neste projeto |
| Supabase (`mcp__a4bdc634…`) | conector da conta claude.ai | login do claude.ai | aponta para o NADA | **NÃO USE.** A nuvem `kqfflkxjijzdtnfshdlv` foi apagada em 01/11/2026. O banco é o da VPS, por SSH (seção 2) |
| Docs (`mcp__1a59c906…`), Figma, Expo (`mcp__6a480db0…`) | conectores da conta claude.ai | login do claude.ai no app | seguem a conta | documentos, design; o Expo é o mesmo do plugin |
| Navegador do app (`Claude_Browser`), Terminal, Visualize, tarefas agendadas, computer-use, sessões (`ccd_*`) | embutidos no **app Claude (desktop)** | nenhuma | ✔ | prévia do site (`.claude/launch.json` → `afline-manager`, porta 5173), terminal, gráficos |
| Claude in Chrome | extensão no Chrome do Emanuel | o Chrome dele | depende do Chrome aberto | só quando o Emanuel pedir |

**Como os MCPs chegam a uma sessão nova:** os do `~/.claude.json` e os plugins valem para
qualquer sessão do Claude Code deste usuário do Windows; os conectores do claude.ai valem para
qualquer sessão logada na mesma conta do claude.ai. Não há `.mcp.json` no projeto — de
propósito: ele iria para o Git com o caminho das chaves.

Conferir: `claude mcp list` (mostra estado de cada um, sem mostrar segredo).

---

## 2. As credenciais fora dos MCPs

| O quê | Onde mora (nesta máquina) | Conferir | Para que serve |
|---|---|---|---|
| **SSH da VPS** `root@187.41.127.166` | `~/.ssh/id_ed25519` (+ `known_hosts`), sem frase-senha | `ssh -o BatchMode=yes root@187.41.127.166 "echo ok"` | **o banco** (`docker exec supabase-db psql -U postgres`), migrations, Edge Functions, `/opt/supabase` — ver `agent_docs/productivity.md` e `docs/12-VPS-ERP.md` |
| **Segredos do Supabase** (`SERVICE_ROLE_KEY`, `JWT_SECRET`, senha do Postgres…) | **só** em `/opt/supabase/.env` na VPS (`chmod 600`) | `ssh … "test -r /opt/supabase/.env && echo ok"` | ignoram o RLS — **nunca** saem da VPS, nunca vão para o front, o Git ou o chat |
| **Cloudflare (Wrangler)** | OAuth em `%APPDATA%\xdg.config\.wrangler\config\default.toml` — conta `emanuel.systembox@gmail.com` (account `26e1a6bdbdf08d94609afe5be850a23e`) | `cd app` e `npx wrangler whoami` | publicar a web (`docs/09-PUBLICAR.md`) |
| **Expo / EAS** | `~/.expo/state.json` — usuário `xlemanuelx`, org `afline-instalacao-e-manutencao-eletrica` | `cd campo` e `npx eas-cli@latest whoami` | APK e `eas update` (`campo/README.md`) |
| **GitHub (git push)** | Git Credential Manager do Windows (`credential.helper = manager`) | `git ls-remote origin` | `github.com/emanuelsystembox-alt/Gestor-AF` |
| GitHub CLI (`gh`) | **não logado** | `gh auth status` | só para PR/issue — se precisar, o Emanuel roda `gh auth login` |
| `app/.env` | na pasta, fora do Git | o script confere as chaves | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable — quem protege é o RLS), `VITE_GOOGLE_MAPS_API_KEY` (restrita por referenciador) |
| `campo/.env` | na pasta, fora do Git | o script confere as chaves | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_MAPS_ANDROID_KEY` |

**Google Maps — desde 04/11/2026 no projeto `pulsoline-mapas`** (conta Google `geminiturbo1@gmail.com`,
"Minha conta de faturamento", hoje em período de teste: R$ 1.830 de crédito, 90 dias). Duas chaves:
**PulsoLine site (mapa)** — só Maps JavaScript API, só os sites `pulsoline.grupoafline.com.br`,
`gestor-af.pages.dev`, `*.gestor-af.pages.dev` e `localhost:5173`; **PulsoLine app do tecnico (Android)**
— só Maps SDK for Android. Orçamento "Alerta PulsoLine R$ 50" (avisa em 25/45/50, sem descontar crédito).
O Google NÃO deixa travar "Map loads per day" nem pôr limite de gasto no Maps: o alerta só avisa. Ver D-307.
A chave antiga (projeto `amazing-coast-h9v0l`, faturamento de um tenant do Cloud Run que ninguém
daqui controla) ficava presa em **100 carregamentos por dia** — foi o "For development purposes only".
| Variáveis da EAS (`--environment preview`) | na conta da Expo | `npx eas-cli@latest env:list --environment preview` | o `eas update` lê daqui, não do `.env` (ver `traps.md`) |
| **Token da Hostinger** | `~/.claude.json` (env do `hostinger-api`) | `claude mcp list` | o MCP da VPS |
| **Acesso do Claude Code ao modelo** | `~/.claude/settings.json` → `env` (`ANTHROPIC_BASE_URL` = gateway `apiclaude.pulsecoding.com.br`, `ANTHROPIC_AUTH_TOKEN`) | a sessão abrir já prova | é por onde esta IA fala com o modelo; outra sessão do mesmo usuário usa o mesmo |

**O que nenhuma IA tem, e é de propósito:**
- **A senha do `admin@afline.com.br`** (e de qualquer login do site). Para conferir uma tela no
  navegador do app, o **Emanuel entra** no painel do navegador; a IA não digita senha.
- A `service_role` fora da VPS. Script que precisa dela (`app/scripts/criar-usuarios-teste.mjs`)
  roda pelo Emanuel, com a chave colada em variável de ambiente na hora.

---

## 3. Mesmo computador, OUTRA conta do Claude (o caso combinado em 02/11)

O que é do **Windows** fica; o que é da **conta do claude.ai** troca.

**Continua igual, sem fazer nada:** SSH da VPS, Wrangler, EAS, Git, os dois `.env`, o MCP
`hostinger-api` (está no `~/.claude.json`), os plugins instalados (`~/.claude/plugins`), as
regras e hooks do projeto (`.claude/`), a **memória** do projeto
(`~/.claude/projects/…NGESTOR-AFLINE/memory/` — a outra conta lê a mesma) e as ferramentas
embutidas do app (navegador, terminal).

**Fica com a conta antiga (a nova não vê):** os conectores do claude.ai — Docs, Figma, o
Expo duplicado (`mcp__6a480db0…`) e o Supabase da nuvem (que não se usa). Nada do projeto
depende deles: o Expo vem pelo plugin, e o banco pelo SSH. O histórico das conversas também
fica na conta antiga — o que importa está no Git, no `HANDOFF.md` e na memória.

**Os logins de MCP por OAuth** (o plugin do Expo) moram em `~/.claude/.credentials.json`, no
mesmo arquivo do login do claude.ai. Para trocar de conta, use **`/login`** (ou o login do app)
— não `/logout` antes, que pode limpar o arquivo. Se depois o `conferir-conexoes.ps1` acusar o
Expo, é um clique: `/mcp` → `plugin:expo:expo` → autenticar.

**Atenção — o gateway:** `~/.claude/settings.json` tem em `env` um `ANTHROPIC_BASE_URL`
(`apiclaude.pulsecoding.com.br`) e um `ANTHROPIC_AUTH_TOKEN`. No Claude Code de terminal, essas
variáveis **passam por cima do login**: a conta nova logaria, mas os pedidos continuariam saindo
pelo gateway, com o token antigo. Se a ideia é a conta nova pagar o uso, o Emanuel tira esse
bloco `env` do arquivo (é configuração dele, de todos os projetos — não é do repositório).

**Depois de trocar:** rodar `conferir-conexoes.ps1` na sessão nova.

## 4. Se for OUTRO computador

Nada disso viaja pelo Git, e nenhum valor deve passar pelo chat. Em outra máquina:

1. **SSH:** copiar `~/.ssh/id_ed25519` e `id_ed25519.pub` (pendrive / cópia direta), ou gerar
   uma chave nova e o Emanuel acrescenta a pública em `/root/.ssh/authorized_keys` na VPS.
2. **Hostinger:** `claude mcp add hostinger-api -s user -e API_TOKEN=<token> -- cmd /c npx -y hostinger-api-mcp@3.22.3`
   (o token o Emanuel tira do painel da Hostinger, ou do `~/.claude.json` desta máquina).
3. **Plugins:** no Claude Code, `/plugin install expo@claude-plugins-official` (e autenticar pelo `/mcp`).
4. **Cloudflare:** `cd app` e `npx wrangler login` (abre o navegador; mesma conta).
5. **Expo:** `cd campo` e `npx eas-cli@latest login`.
6. **`.env`:** copiar `app/.env` e `campo/.env` desta máquina (ou partir do `.env.example` e
   preencher — a publishable está no painel Studio da VPS; o Maps, no Google Cloud).
7. **Git:** o primeiro `git push` pede o login do GitHub pelo Credential Manager.
8. Conectores do claude.ai: entrar no app com a mesma conta — eles vêm junto.
9. Rodar `conferir-conexoes.ps1`.

---

## 5. Nunca

- Escrever valor de chave, token ou senha neste repositório (inclusive em `.mcp.json`).
- Usar o MCP do Supabase da nuvem — o banco é o da VPS.
- Colar `service_role`, `JWT_SECRET` ou senha de banco no chat ou em tela.
- Mexer na outra VPS da conta Hostinger (`gestao.gruporainhaisabel.com`).
