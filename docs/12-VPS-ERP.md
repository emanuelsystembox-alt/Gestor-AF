# A VPS `erp.grupoafline.com` — um computador ligado 24 h fora da AFLINE

**Situação em 31/10/2026: o Supabase do projeto vai MIGRAR para cá** — banco,
login, arquivos, tempo real, função e agendador. A pilha já está instalada e
saudável, **vazia**; o sistema continua rodando no Supabase da nuvem até a troca.
Ver "A migração do Supabase", abaixo.

> **Por que uma VPS, se o banco e a web já estão na nuvem?** O Supabase e a
> Cloudflare guardam dado e servem tela; não deixam um **navegador** aberto. A
> extensão do TOA (D-193) só trabalha dentro de um Chrome ligado e logado — hoje,
> o Chrome da máquina do Emanuel. A VPS é a candidata a ser esse Chrome sem
> depender de ninguém deixar o PC ligado. **Ainda não foi decidido** (ver
> "Em aberto").

## A máquina

| | |
|---|---|
| Provedor | Hostinger, plano KVM 2 (id 2098432), datacenter **Campinas (SP)** desde 07/11/2026 (era Boston) |
| Recursos | 2 vCPU · 8 GB RAM · 100 GB disco |
| Sistema | Ubuntu 26.04.1 LTS |
| IP | `187.41.127.166` (Campinas, desde 07/11/2026; antes `179.197.82.110` em Boston) |
| Conta | **de outro titular**: o Emanuel entra no hPanel como "acesso de administrador" |

A mesma conta tem a VPS `gestao.gruporainhaisabel.com` (2.25.99.214). **Não é a
de trabalho** — não mexer nela. As duas telas do hPanel são iguais; confira o
título no topo antes de clicar em qualquer coisa. No terminal, o prompt diz
qual é (`root@erp` × `root@gestao`).

## O que roda nela

| Pasta | O que é | Porta | Quem montou |
|---|---|---|---|
| `/opt/n8n` | n8n + Postgres 16 + Caddy (HTTPS) | **80/443, públicas** | "alisson", 26/10 |
| `/opt/dashboard` | página estática, com usuário e senha, servida pelo Caddy | (pelo Caddy) | "alisson", 26/10 |
| `/opt/portainer` | Portainer CE 2.45.2 — painel visual do Docker | 9443, **só local** | 29/10 |
| `/opt/edge` | Microsoft Edge (linuxserver/msedge `157.0.4341.42-1-ls214`) visto pela web — trocou o Chromium em 07/11 | 3001, **só local** | 07/11 |
| `/opt/supabase` | **Supabase self-hosted** `self-hosted/v0.8.3` (11 containers) | 8000 API, 5432/6543 banco — **só local** | 31/10 |
| `/opt/monitor` | Netdata v2.12.1 — carga da máquina e de cada container | 19999, **só local** | 31/10 |

O Caddy publica `n8n.alissonia.cloud` e `afline.alissonia.cloud`. **Antes de
mexer no `/opt/n8n` ou no Caddyfile, falar com o alisson** — não sabemos o que
depende deles.

Cada peça tem o seu `docker-compose.yml` de propósito: reiniciar ou atualizar uma
não derruba a outra. Todas com `restart: unless-stopped` — voltam sozinhas se a
VPS reiniciar.

## Por que o painel e o navegador NÃO estão na internet

**Quem controla o Docker é root na máquina**, e o navegador **não tem senha
própria**: quem abre a tela dele usa o Chrome da VPS, já logado no que estiver
logado. Os dois escutam só em `127.0.0.1`, e o acesso é pelo túnel SSH, que já é
criptografado e já exige a chave. Testado de fora: as portas 9443 e 3001 não
respondem.

Endereço público com HTTPS **não foi feito**, e não por esquecimento:
`grupoafline.com` tem o DNS na `systemdns.com` (fora da Hostinger) e
`alissonia.cloud` está numa conta que não enxergamos. Se um dia for publicar,
o navegador **nunca** — só o Portainer, e com a senha dele como única porta.

## Como entrar

```bash
ssh -L 3001:127.0.0.1:3001 -L 9443:127.0.0.1:9443 -L 8000:127.0.0.1:8000 -L 19999:127.0.0.1:19999 root@187.41.127.166
```

Com o túnel aberto: **https://localhost:3001** (navegador),
**https://localhost:9443** (Portainer), **http://localhost:8000** (Studio do
Supabase — usuário e senha em `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` do
`/opt/supabase/.env`) e **http://localhost:19999** (monitoramento). O aviso de certificado é esperado — o
certificado é do próprio container, e a conexão já vai dentro do SSH.

**O túnel é só a janela.** Fechar a aba, o túnel ou desligar o PC não fecha o
Chromium: ele continua aberto na VPS, com abas e logins (perfil em
`/opt/edge/config`).

O SSH entra com a chave `~/.ssh/id_ed25519` da máquina do Emanuel, cadastrada no
root pela API da Hostinger. O Web console do hPanel usa `root` e a senha
definida em "Redefinir senha".

## Acessos e segredos — onde estão, nunca o quê

| Acesso | Onde mora |
|---|---|
| chave SSH (privada) | `C:\Users\Emanu\.ssh\id_ed25519` — só lá |
| token da API Hostinger | `C:\Users\Emanu\.claude.json` (servidor MCP `hostinger-api`) |
| admin do Portainer | criado pelo Emanuel na primeira tela |
| senha root | definida pelo Emanuel no hPanel |

> **O token da API passou pelo chat em 29/10.** Ele controla a conta inteira
> (inclusive reinstalar a VPS). Revogar e gerar outro no hPanel › API é a
> recomendação que ficou de pé; ao trocar, refazer o `claude mcp add hostinger-api`.

## Cuidados

- **Snapshot:** tirado em 29/10 12:43 (Manaus); a API diz que vale até 30/10
  12:43. A Hostinger guarda **um** por VPS — tirar outro apaga o anterior. **Não
  há backup automático.** Antes de qualquer mudança grande, snapshot novo.
- **Firewall:** nenhum. Hoje só 22, 80 e 443 escutam para fora.
- **Navegador desatualizado é porta de ataque.** A imagem é fixa; atualizar
  trocando a tag no compose e `docker compose up -d`.
- **Memória:** o navegador tem teto de 3 GB para nunca disputar com o n8n. Em
  29/10: 1,5 GB usados de 7,7.

## Em aberto — conversar antes de usar

**Navegador aberto não é robô.** Ele espera alguém clicar. Para trabalhar
sozinho, precisa de uma extensão rodando nele (a do TOA) ou de um script /
fluxo do n8n pilotando. Se a ideia for a **extensão do TOA**, conferir antes de
confiar:

1. **Aba escondida não desenha** (`agent_docs/traps.md`). Numa tela virtual que
   ninguém está olhando, o Chrome pode se achar escondido e a varredura errar
   por tempo esgotado em tudo. **É o risco maior, e não foi testado.**
2. **O login do TOA expira.** Quando cair, alguém entra pelo túnel e loga de novo
   — e precisa ficar sabendo que caiu.
3. **O acesso sai do IP da VPS**, não do da AFLINE. Se a CLARO restringir o TOA
   por IP ou estranhar o acesso de um datacenter, não entra.
4. **Duas extensões ao mesmo tempo** (a do PC e a da VPS) varrendo o mesmo
   bucket — quem fica com qual.
5. **Dado de assinante** passa a ficar numa máquina de outra conta (LGPD): o
   perfil do Chrome guarda sessão e cache do TOA.

Nenhum desses foi decidido. Pergunte ao Emanuel.

---

## A migração do Supabase (decidida em 31/10)

*"vamos fazer a migração para a nossa VPS"* (Emanuel, 31/10). Sai do Supabase
na nuvem (projeto `kqfflkxjijzdtnfshdlv`, São Paulo, plano Free) para o mesmo
Supabase instalado aqui.

### Por que o Supabase instalado, e não outra coisa

O sistema usa **todas** as peças do Supabase, não só o banco (medido em 31/10):

| Peça | Hoje |
|---|---|
| Postgres 17 | 207 MB · 92 tabelas · 312 funções (250 `SECURITY DEFINER`) · 176 policies |
| API (PostgREST) | 237 mil chamadas de `authenticated` desde 08/10 |
| Auth | 91 usuários, só e-mail e senha · 14 entraram nos últimos 30 dias |
| Storage | `evidencia`, `foto_perfil`, `mural` (privados) · 17 arquivos, 44 MB · 11 policies |
| Realtime | 8 tabelas: `visita_evento`, `aviso`, `mensagem`, `gps_alerta`, `cerca_evento`, `mensagem_colega`, `mensagem_interna`, `grupo_mensagem` |
| Edge Function | `admin-usuarios` |
| pg_cron | `expurgar-rastro` (07:17 UTC) |

109 funções dependem de `auth.uid()`. Trocar o Supabase por outra pilha seria
reescrever o sistema. Instalado aqui, web, app e extensão mudam só **o endereço e
as chaves**.

### O que se ganha e o que passa a ser nosso

- **Sai do teto do plano Free**, e um já está perto: o banco tem **207 MB dos 500
  MB**, e `importacao_linha` sozinha tem 125 MB. Sai também o limite de 1 GB de
  arquivo (vídeo de evidência) e o `statement_timeout` de 8 s volta a ser
  escolha nossa.
- **Não se paga o Supabase**, em volume nenhum: o self-hosted é código aberto. O
  custo é o plano da VPS, e sobe por degrau quando o monitoramento mostrar.
- **Passa a ser nosso:** backup, atualização de segurança e manter no ar. O que
  hoje o Supabase faz sem ninguém ver.

### Decisões do Emanuel (31/10)

| Ponto | Decisão |
|---|---|
| Datacenter | fica em **Boston** — *"isso não me interessa"* |
| n8n do alisson | fica como está — *"já falei com ele"*. **Não mexer no Caddy dele.** |
| Web | continua na Cloudflare Pages |
| Domínio da API | ele vai providenciar — *"vou procurar um DNS logo logo"*. Até lá, tudo só em 127.0.0.1 |
| Backup fora da VPS | *"vamos estudar um valor"* — **sem destino ainda; obrigatório antes da troca** |

### O que já está montado (31/10)

- **`/opt/supabase`**, pelo instalador oficial (`setup.sh`, release
  `self-hosted/v0.8.3`). Postgres `17.6.1.136` — mesma versão maior/menor da
  nuvem (`17.6.1.166`). Os segredos foram gerados pelo instalador e estão só em
  `/opt/supabase/.env` (`chmod 600`); conferido que nenhum ficou no valor de
  exemplo.
- **Todas as portas presas em 127.0.0.1** por `docker-compose.afline.yml`, ligado
  no `COMPOSE_FILE` do `.env`. Sem ele a API (8000) e o banco (5432/6543) ficariam
  abertos — e porta publicada pelo Docker passa por cima do `ufw`. Fica num
  arquivo à parte para o `update.sh` do Supabase não desfazer. Testado de fora:
  as três não respondem.
- **Auth igual ao de hoje:** cadastro aberto desligado (`DISABLE_SIGNUP=true`,
  testado: *"Signups not allowed"*), sem anônimo, sem telefone, `SITE_URL` =
  `https://gestor-af.pages.dev`. Acesso novo continua nascendo só pela
  `admin-usuarios`.
- **`admin-usuarios`** copiada para `volumes/functions/`, com
  `FUNCTIONS_VERIFY_JWT=true` (como na nuvem). **Não testada** — precisa do banco.
- **Netdata** em `/opt/monitor`: CPU, memória, disco, rede e cada container. É a
  "visão" de quando aumentar a máquina. Alertas padrão ligados, mas **sem
  destino** — por enquanto só aparecem no painel.

As 11 peças sobem saudáveis. Com o Supabase vazio, a VPS foi a **2,4 GB
usados de 7,7**.

> A versão nova usa a chave **publicável** (`sb_publishable_…`), o mesmo tipo que
> a web e o app já usam. Com ela a função `hello` responde 200; a raiz da API só
> abre para a chave de serviço, e a saúde do Realtime é rota de administrador —
> os 401/403 nessas duas são o esperado, não defeito.

### O que falta, em ordem

1. **Copiar o banco** (papéis, schema, dados, `auth.users` com as senhas) e os
   44 MB do Storage. Precisa da **senha do banco da nuvem**, que o Emanuel pega no
   painel do Supabase (Connect → Session pooler) e grava **direto na VPS**, nunca
   no chat.
2. Conferir na cópia: as duas baterias (`testar_policies`, `testar_campo`), as
   configurações de papel (o `statement_timeout` de 8 s de `authenticated` mora
   no papel, e **não vem** num `pg_dump` comum), o `pg_cron`, as 8 tabelas do
   Realtime e a `admin-usuarios`.
3. Coletor do Postgres no Netdata (conexões, consultas lentas, tamanho).
4. **Backup diário para fora da VPS** — antes da troca, sem exceção.
5. **Domínio com HTTPS** para a API. Só então web, app (`eas update`) e extensão
   apontam para cá. Todo mundo entra de novo uma vez (chaves novas).
6. Troca num horário combinado. O Supabase da nuvem fica de reserva até termos
   certeza; só depois se apaga.

### O que deu errado na instalação

**O `setup.sh` trocou o Docker da máquina, e o n8n caiu ~3 minutos.** Rodado com
`--skip-deps`, ainda assim houve um `apt install docker-ce …` às 19:28 UTC que
**removeu** o Docker do Ubuntu (`docker.io`, `containerd`, `runc`) e terminou com
erro do `dpkg` — o serviço do Docker ficou parado. Religado na mão; depois
`dpkg --configure -a` concluiu a troca. Ficou o **Docker oficial 29.9.2** (antes
o do Ubuntu, 29.1.3), com o `docker-compose-v2` do Ubuntu. `dpkg --audit` e
`apt-get check` limpos; n8n respondendo 200. **Não confirmei qual linha do
script disparou o `apt`** apesar da opção.

### Ensaio da cópia do banco (31/10, 19:51 UTC)

**É ensaio, não a troca.** A nuvem continua recebendo dado; na troca, a cópia
se refaz do zero com o mesmo roteiro, já conferido.

**Como se exporta** — Supabase CLI `2.121.0` em `/opt/supabase-cli` (checksum
conferido), o caminho oficial em três arquivos: `--role-only`, estrutura e
`--data-only --use-copy`. A senha do banco da nuvem mora em
`/root/.origem-supabase.env` (`chmod 600`), gravada pelo Emanuel com
`/root/senha-supabase.sh`, que lê sem eco. A exportação **só lê** a nuvem.
Os arquivos ficam em `/root/migracao/<data>/` (`chmod 700`) — **têm dado de
assinante: apagar depois da troca.**

**Como se restaura** — numa transação só (`--single-transaction`,
`ON_ERROR_STOP`), como `supabase_admin` (aqui o `postgres` não é superusuário, e
`session_replication_role = replica` exige): papéis → estrutura → dados →
`complementos.sql`. 6 segundos, nenhum erro.

**O que o dump NÃO leva, e tem de ir à mão** (`complementos.sql`):
- as **11 policies de `storage.objects`** (evidência, foto de perfil, mural) — o
  dump só leva o schema `public`;
- o agendamento **`expurgar-rastro`** do `pg_cron`.

**A armadilha que pegou: as permissões.** O self-hosted dá `GRANT` automático a
`anon`/`authenticated`/`service_role` em todo objeto criado, e o `pg_dump` só
grava o que difere do padrão do Postgres. Restaurado assim, **as 250 funções
`SECURITY DEFINER` ficaram executáveis por quem não está logado** (na nuvem: 0).
Correção (`perm-zerar.sql` → os 1.201 `GRANT/REVOKE` de funções e tabelas do dump
→ `perm-conferir.sql`), numa transação que só confirma se a assinatura bater com
a da nuvem. A assinatura compara o **efeito** (objeto | quem recebe | permissão),
não o texto do ACL — o texto carrega o *grantor*, que muda conforme quem rodou o
`GRANT` sem mudar quem pode o quê.

| Conferido na VPS | Nuvem | VPS |
|---|---|---|
| linhas, tabela a tabela (96 tabelas) | — | 94 iguais; `rastro_ponto` −1 e `sinal` −7 = o que entrou na nuvem depois das 19:51 |
| funções / `SECURITY DEFINER` | 312 / 250 | 312 / 250 |
| policies `public` + `storage` | 163 + 11 | 163 + 11 |
| gatilhos `public` | 23 | 23 |
| tabelas sem RLS | 0 | 0 |
| funções que o `anon` executa / definer abertas ao `anon` | 18 / 0 | 18 / 0 |
| permissões de funções e tabelas (assinatura do efeito) | — | **idênticas** |
| tabelas do Realtime | 8 | 8 |
| `statement_timeout` authenticated / anon | 8 s / 3 s | 8 s / 3 s |
| usuários com senha bcrypt | 91 | 91 |
| `pg_cron` | `expurgar-rastro 17 7 * * *` | idem, ativo |
| **`testar_policies()`** | 33 | **33/33** |
| **`testar_campo()`** | 29 | **29/29** |

**Arquivos do Storage (20h UTC):** os 17 (evidência 15, foto de perfil 1, mural
1; 44 MB) baixados da nuvem com a chave secreta (gravada pelo Emanuel com
`/root/chave-supabase.sh`, sem eco) e subidos na VPS por
`/root/migracao/copiar_storage.py`. Cada um conferido duas vezes: tamanho
baixado = tamanho registrado no banco, e sha256 relido da VPS = baixado da nuvem.
**17/17.** O upload com `x-upsert` manteve `id`, dono e data de cada objeto —
conferido contra uma cópia tirada antes.

**Login, API, função e Realtime, com uma sessão de verdade** (20h10 UTC). Sem
senha de ninguém: o Auth da VPS gera um link de acesso para um ADMIN
(`generate_link` não envia e-mail) e o script o troca por sessão — só na cópia.

| Teste | Resultado |
|---|---|
| Auth emite sessão para usuário vindo da nuvem | sim |
| Contagens como esse ADMIN na VPS × na nuvem (`set local role authenticated`) | visita até 30/10 **5.361 = 5.361**, O.S. **7.134 = 7.134**, perfil **91 = 91**, evidência **5 = 5** (RLS filtrando a cidade ativa) |
| `tem_permissao('admin.usuarios')` | `true` nos dois |
| `admin-usuarios` "criar" com dados faltando | percorre token → permissão → perfil e recusa *"Faltam dados obrigatórios"* (400), sem criar nada |
| função `SECURITY DEFINER` sem login | `permission denied` (401) |
| Realtime (`supabase-js` 2.116.0, a do app): INSERT em `visita_evento` | assinado como o ADMIN, **evento recebido** (id enviado = id recebido); o evento de teste foi apagado |

As duas chaves da VPS funcionam do lado do cliente: a publicável
(`sb_publishable_…`, a que web e app usam) e a `ANON_KEY` antiga. A sessão de
teste foi apagada da cópia e o token destruído.

**Ainda NÃO conferido:** a web, o app e a extensão de verdade apontando para a VPS
— isso só depois do domínio com HTTPS; e o `pg_cron` disparando de fato (só o
agendamento foi conferido; roda às 07:17 UTC).

**Regra para toda cópia daqui em diante:** depois de restaurar, rodar
`perm-conferir.sql` (com as assinaturas medidas na nuvem NO MESMO DIA) e as duas
baterias. Restauração sem essa conferência abre o banco para quem não está logado.

### Os endereços (31/10)

O `grupoafline.com.br` é da AFLINE e o DNS dele está na **HostGator** (cPanel
`br244.hostgator.com.br`, `ns244`/`ns245`). Criados no Zone Editor em 31/10, a
pedido do Emanuel (*"podemos criar então pulsoline.grupoafline.com.br?"*):

| Nome | Registro | Para quê |
|---|---|---|
| `api.pulsoline.grupoafline.com.br` | **A** → `187.41.127.166` (TTL 300) | a **API** (o Supabase da VPS). Ninguém digita: web, app e extensão usam por trás |
| `pulsoline.grupoafline.com.br` | **CNAME** → `gestor-af.pages.dev` | o **site**, com nome da empresa. Cadastrado também como domínio do projeto `gestor-af` na Cloudflare Pages (API, com o login do Wrangler) |

`gestor-af.pages.dev` continua funcionando; o nome novo é um segundo caminho
para o mesmo site.

Já existia no mesmo DNS `erp.grupoafline.com.br` → hoje `187.41.127.166`, criado
antes por alguém; nada na VPS usa esse nome. Não foi mexido.

Tentativas que NÃO deram certo, para ninguém repetir: o `grupoafline.com`
(sem `.br`) tem DNS na systemdns.com, fora do alcance; o domínio grátis
"pendente" da conta Hostinger veio com o plano da VPS `gestao` (criado no mesmo
segundo que ela) e recusou `.net` e `.online` — não foi usado.

**HTTPS da API (31/10, liberado pelo alisson).** As portas 80/443 da VPS são
do Caddy dele, então a API entra por ele:

- `/opt/n8n/Caddyfile` ganhou o bloco `api.pulsoline.grupoafline.com.br`, que
  repassa **só** `/rest/v1`, `/auth/v1`, `/storage/v1`, `/realtime/v1` e
  `/functions/v1` para `supabase-envoy:8000`. Todo o resto — o Studio (`/`), o
  pg-meta (`/pg`) — responde **404** de fora; o Studio segue só pelo túnel.
- O Caddy foi ligado à rede `supabase_default` com `docker network connect`
  (sem reiniciar: o n8n não piscou) e a ligação ficou registrada em
  `/opt/n8n/docker-compose.override.yml`, para sobreviver a uma recriação.
- Aplicado com `caddy validate` antes e `caddy reload`, gravando NO MESMO
  arquivo (`cat > Caddyfile`): o Caddyfile entra no container por bind mount de
  arquivo, e `sed -i`/`mv` trocariam o inode — o container continuaria vendo o
  antigo.
- Cópia do que havia antes: `/opt/n8n/backup-afline-20261101-0023/`.
- Certificado Let's Encrypt emitido na hora, válido até 29/01/2027; o Caddy
  renova sozinho.
- No Supabase: `SUPABASE_PUBLIC_URL` e `API_EXTERNAL_URL` passaram ao endereço
  novo, e `ADDITIONAL_REDIRECT_URLS` aos dois do site (cópia anterior:
  `/opt/supabase/.env.antes-dominio`).

Testado DE FORA, do PC do Emanuel: auth, storage, functions e rest **200**;
Realtime abre o WebSocket (**101**); `/`, `/project/default`, `/pg/tables`
**404**; certificado válido; n8n **200** e o dashboard do alisson pedindo senha
(**401**), como antes. O site abre em `https://pulsoline.grupoafline.com.br`
(**200**).

### Publicação do site depois da migração

Nada muda no jeito de publicar: o código continua no GitHub
(`emanuelsystembox-alt/Gestor-AF`) e o site na Cloudflare Pages, publicado à mão
pelo Wrangler (`docs/09-PUBLICAR.md`). Na troca, mudam só as duas variáveis do
`app/.env` (`VITE_SUPABASE_URL` → `https://api.pulsoline.grupoafline.com.br` e a
chave publicável nova da VPS), e o site é republicado uma vez. O mesmo no app
(`eas update`) e na extensão (`npm run extensao`).

## A TROCA (01/11/2026, 00:34–00:48 UTC = 31/10, 20:34–20:48 em Manaus)

*"pode fazer a troca agora, ninguém está usando"* — e, perguntado se pausava o
Supabase da nuvem no fim: *"Troca sem pausar"* (Emanuel). **Desde 00:48 UTC o
sistema roda na VPS.** A nuvem segue LIGADA, com os dados até a troca.

Não estava parado de todo: um celular de técnico mandava GPS em segundo plano e
uma importação tinha rodado às 00:08 UTC. Ninguém usava as telas.

**O que foi feito, em ordem:**
1. Assinatura das permissões da nuvem medida de novo (igual à do ensaio, apesar
   da 166 aplicada à tarde por outra sessão).
2. Banco e arquivos da VPS zerados — o ensaio ficou em
   `/opt/supabase/volumes/db/data.ensaio` e `volumes/storage.ensaio`.
3. Exportação às **00:34:21 UTC** (`/root/migracao/20261101-0034/`) e restauração
   numa transação ÚNICA que inclui a correção e a conferência das permissões: o
   banco nunca existiu com as definer abertas ao `anon`. 6,7 s.
4. 17/17 arquivos (sha256), 11 policies de storage idênticas (md5), `pg_cron`
   ativo, **testar_policies 33/33, testar_campo 29/29**.
5. **Site**: `app/.env` → `https://api.pulsoline.grupoafline.com.br` + chave
   publicável da VPS; `tsc` e build limpos; publicado. Conferido NO AR nos dois
   endereços (`gestor-af.pages.dev` e `pulsoline.grupoafline.com.br`): o bundle
   cita a VPS e não cita a nuvem. CORS da API aceita os dois e
   `chrome-extension://`.
6. **Extensão do TOA**: `npm run tsc:extensao` + `npm run extensao` →
   `extensao-toa/fundo.js` com o endereço novo.
7. **App do técnico**: variáveis do ambiente `preview` da EAS, `campo/eas.json`
   (os 3 perfis) e `campo/.env` trocados; `eas update` publicado para o runtime
   **0.6.0** (APK de 31/10 18:10) **e para o 0.5.0** (APKs anteriores) — ver
   abaixo.
8. O que entrou na nuvem durante a troca: contagem tabela a tabela de novo, e
   só `rastro_ponto` diferia (1 ponto de GPS). Copiado com o id original.
9. Teste pelo endereço público com sessão real de ADMIN: contagens iguais e uma
   foto de evidência baixada inteira (137.770 bytes).

**O runtime do app.** O `app.json` estava em **0.6.0** e "PulsoLine" por mudança
NÃO commitada de outra sessão (o APK 0.6.0 já foi gerado, às 18:10 UTC). O
primeiro `eas update` saiu só para o 0.6.0 — os celulares no 0.5.0 não iam
receber. Publicado de novo para o 0.5.0 (versão trocada só durante o comando;
`package.json` igual ao commit, sem nativo novo, e o OTA "PulsoLine" das 18h já
tinha ido ao 0.5.0 com este código). E o `eas update` **inchou o `app.json` de
novo** (permissões em dobro, `runtimeVersion` a mais — `traps.md`): restaurado
byte a byte.

### O que ainda depende de gente

- **Todo mundo entra de novo uma vez** — site, app e extensão (chaves novas).
- **Celular do técnico**: a atualização só entra quando o app é **fechado e
  aberto**. Até lá, ele **continua gravando na NUVEM** (o GPS em segundo plano
  inclusive). O ponto de GPS que chegava em 00:41 era de um técnico de São Luís.
- **Extensão do TOA**: no PC onde ela roda, `chrome://extensions` → **recarregar**
  "AFLINE — ponte com o TOA". Até lá, a sincronização automática **grava na
  NUVEM**.
- Como a nuvem não foi pausada, o que cair nela por esses dois caminhos não
  aparece na VPS. Conferir de novo (contagem tabela a tabela) e copiar o que
  entrou depois das 00:48 UTC.

### Limpeza que ficou para depois da troca firmar

- `/root/migracao/` (dois dumps com dado de assinante), `volumes/db/data.ensaio`
  e `volumes/storage.ensaio` — **LGPD: apagar**.
- Trocar a **senha do banco da nuvem** (metade apareceu num print) e **gerar
  chave secreta nova** na nuvem; apagar `/root/.origem-supabase.env`.
- **Backup**: não há nenhum (decisão do Emanuel, "é temporário").

### O endereço antigo do site manda para o novo (01/11)

*"preciso desativar esse link, não deve mais carregar a página nele"* e *"quero
apenas que as pessoas acessem o site pelo site novo"* (Emanuel). A Cloudflare não
deixa apagar o `*.pages.dev` de um projeto, então `app/functions/_middleware.js`
devolve **301** de `gestor-af.pages.dev` (e das prévias `*.gestor-af.pages.dev`)
para `https://pulsoline.grupoafline.com.br`, com o mesmo caminho. Conferido no
ar: `/entrar`, `/`, `/controle/sincronismo?x=1` e uma prévia → 301 para o
mesmo caminho no novo; o novo responde 200 e a tela de entrada carrega sem erro.

Junto:
- **Extensão 0.6.1**: o content script (`ponte.js`) passou a valer também em
  `pulsoline.grupoafline.com.br` — sem isso, a tela de Sincronismo no endereço
  novo não falava com a extensão. O botão "abrir" do popup aponta para o novo.
  Os endereços antigos continuam no manifesto (inofensivos com o 301).
- **Login da VPS**: `SITE_URL` = endereço novo.
- **Chave do Google Maps do site** (`…-CpY`, projeto `amazing-coast-h9v0l`,
  "Browser key (auto created by Firebase)"): está **sem restrição de site** —
  o `mapaGoogle.ts` e o `09-PUBLICAR.md` dizem que deveria estar restrita, e não
  está. Por isso o mapa já funciona no endereço novo. Oferecida a restrição, o
  Emanuel **recusou** (*"não quero bloquear o google apenas para meu site"*).

### O que o Emanuel pediu e NÃO foi feito

- **Apagar o Supabase da nuvem.** Recomendado não apagar: é a única cópia fora da
  VPS (não há backup), e tem o que celulares e extensão ainda não atualizados
  gravaram depois da troca. Apagar é irreversível e fica com ele (Project Settings
  › General › Delete project). Pausar, que é reversível, foi oferecido.
- **"Instalar" o Gerenciador Docker do hPanel**: recomendado não clicar — mexe no
  Docker da máquina, como o `setup.sh` que derrubou o n8n. O Portainer já faz isso.

### Atalho para os painéis (sem terminal)

`Paineis da VPS.bat` na Área de Trabalho do Emanuel: abre o túnel SSH e, em
seguida, monitoramento (19999), Studio (8000), Portainer (9443) e o navegador da
VPS (3001). Os painéis funcionam enquanto a janela preta estiver aberta.

## O Supabase da nuvem foi APAGADO (01/11/2026)

*"eu quero deixar tudo em nosso banco agora, quero acabar com o supabase online,
quero tudo em nossa VPS mesmo não tendo backup"* — e, depois: *"pronto, apaguei o
projeto do supabase online"* (Emanuel, que fez a exclusão pelo painel). Conferido:
o MCP não acha mais o projeto e `kqfflkxjijzdtnfshdlv.supabase.co` não resolve.

**A VPS é agora a ÚNICA cópia do sistema, e não há backup.** O que celulares não
atualizados e a extensão não recarregada gravaram na nuvem depois da troca foi
junto com ela.

Limpeza feita na VPS: a senha e a chave secreta da nuvem (`shred`), os scripts
que as usavam, o dump do ensaio e as pastas `*.ensaio` (~680 MB com dado de
assinante). **Ficou só o dump da troca**, `/root/migracao/20261101-0034/`
(176 MB, `chmod 700`): é a única foto do banco fora dele mesmo — protege contra
apagar dado por engano, não contra perder a VPS.

**O que ficou desatualizado na documentação do projeto** e precisa mudar:
`CLAUDE.md`, `agent_docs/productivity.md` e `agent_docs/security.md` ainda
mandam usar o **MCP do Supabase** no projeto `kqfflkxjijzdtnfshdlv` — que não
existe mais. Hoje o banco se acessa por SSH:
`docker exec supabase-db psql -U postgres -d postgres` (como `authenticated`,
para medir e testar, segue valendo o `set local role`).

## O portal da Claro e a mudança para Campinas (estudado em 07/11/2026 — NÃO feito)

**O problema.** O Chromium da VPS não abria o Portal Técnico da Claro (`ERR_EMPTY_RESPONSE`),
e da máquina do Emanuel abria. Medido em 07/11, sem login nenhum (só a página de login pública):

| Porta de entrada da Claro (AWS, us-east-1) | Da VPS | Da máquina do Emanuel |
|---|---|---|
| `35.174.77.4` | **recusa** — fecha logo depois do TLS, 4 de 4 | abre (200) |
| `100.25.108.9` | abre (200; API 401 sem login), 4 de 4 | abre |

O DNS da Claro sorteia uma das duas a cada acesso: da VPS, **metade abre e metade não**. Não é
bloqueio por uso nosso (recusa até a página pública, sem cookie, igual em toda tentativa, e a outra
porta aceita a mesma VPS): uma das portas tem um filtro que a outra não tem. A VPS está em
**Boston** (data center 24 da Hostinger) e o IP é registrado nos EUA. Consequência: a leitura do
portal pela extensão na VPS (D-330) acerta mais ou menos metade das rodadas.

**Os caminhos, em ordem de preferência do que foi conversado:**
1. **Mudar a VPS para o data center de Campinas (SP)** — existe na Hostinger (id 22, "cam"). Faz
   pelo **hPanel** (a API não tem a operação). Provavelmente resolve o portal (a porta que recusa
   aceita IP do Brasil) e deixa site/app mais rápidos para Manaus e São Luís. Pode não resolver se
   o filtro for "nada de data center", mesmo brasileiro.
2. **Fixar na VPS a porta que funciona** (`/etc/hosts` só para os nomes da Claro) — rápido e
   frágil: a AWS troca esses IPs e um dia para sem aviso.
3. **Extensão num computador no Brasil**, ligada sem bucket marcado, só para o portal (a VPS
   continua com o TOA). Funciona hoje.
4. Extensão de VPN no navegador: as boas gratuitas **não têm Brasil** no plano grátis (conferido
   07/11 nos sites: Windscribe — só Pro; Proton — 10 países sorteados; TunnelBear — escolher país
   só no pago). As grátis com Brasil (Hola, Urban VPN) não servem num navegador com sessões do TOA,
   do PulsoLine e do portal (LGPD). Windscribe Pro anunciava US$ 29/ano até 30/11.

**Checklist da mudança para Campinas (quando o Emanuel decidir):**
- **Um dia ANTES:** baixar o TTL dos registros que apontam para `179.197.82.110` na **HostGator**
  (DNS de `grupoafline.com.br`: `ns244/ns245.hostgator.com.br`, TTL padrão **86400 = 1 dia**) para
  300. Sem isso, celular e PC continuam no IP velho por até 24 h depois da troca.
- **Avisar o Alisson:** o n8n dele (`n8n-n8n-1`, `n8n-caddy-1`, `n8n-postgres-1`) mora aqui e
  também troca de IP.
- **Backup antes:** o único backup da Hostinger é de **03/11** (restauração ~46 min). Cópia do banco
  (~1 GB) e de `/opt/supabase/volumes` para a máquina do Emanuel + **snapshot** da Hostinger logo
  antes de clicar.
- **A conta da VPS é de outro titular** (o Emanuel entra como administrador) — confirmar que o
  acesso dele permite a mudança.
- **À noite**, sem técnico em campo. Depois: novo IP nos registros da HostGator, conferir site, app,
  `api.pulsoline`, as duas baterias, n8n, a extensão, o portal da Claro da VPS — e trocar o IP nos
  16 lugares da documentação que citam `179.197.82.110` (`grep -rn 179.197.82.110`).

## A mudança para Campinas por REINSTALAÇÃO (decidida em 07/11/2026, à noite)

O Emanuel escolheu a opção do hPanel **"Alterar localização do servidor"**, sabendo que ela
**reinstala** (apaga o disco) e que não há volta pela Hostinger. A volta é a nossa cópia, no PC.
Não existe operação de mudar de lugar na API da Hostinger (conferido em 07/11).

**O que roda na VPS e precisa voltar** (inventário de 07/11, 22:51 UTC):

| Peça | Onde | Volta por |
|---|---|---|
| Supabase (11 containers, banco 1,06 GB, Storage 1,1 GB, funções, `.env` com as chaves) | `/opt/supabase` | `opt.tar.gz` (banco cru, cópia fria) · plano B `supabase-pg_dumpall.sql.gz` |
| n8n + Postgres 16 + Caddy do Alisson (o Caddy também publica a nossa API) | `/opt/n8n`, `/opt/dashboard`, volumes `n8n_*` | `opt.tar.gz` + `volumes.tar.gz` · plano B `n8n-pg_dumpall.sql.gz` |
| Chromium 24 h com a extensão e os logins | `/opt/navegador/config` | `opt.tar.gz` |
| Portainer, Netdata | `/opt/portainer`, `/opt/monitor`, volume `portainer_portainer_data` | idem (o histórico do Netdata não volta: 1,2 GB de gráfico) |
| Chaves de entrada SSH (Emanuel + celular), chaves do servidor, sshd, firewall (22/80/443) | `/root/.ssh`, `/etc/ssh`, ufw | `sistema.tar.gz` |
| `pg_cron` (6 jobs) | dentro do banco | vem com o banco |
| Imagens `n8n:stable`, `postgres:16-alpine`, `caddy:2-alpine` (etiqueta que muda) | — | baixadas pelo **digest** guardado (a mesma versão) |

**Os scripts** (`scripts-vps/`): `copia-para-mudanca.sh quente|fria` faz a cópia na VPS e confere
(sha256); `volta-depois-da-mudanca.sh <pasta-fria>` monta tudo de novo na máquina nova. A cópia
desce para **`C:\Users\Emanu\backup-vps-erp\`** — fora do OneDrive e do Git de propósito: tem dado de
assinante e as chaves (`service_role`, JWT). Ensaio quente em 07/11: 1,3 GB em 1 min 21 s na VPS.

**Contagens de referência** (07/11, 22:51 UTC — a volta tem de bater, depois da cópia fria):
visita 100.905 · ordem_servico 143.185 · visita_evento 111.575 · evidencia 4.590 ·
storage.objects 4.621 · equipamento 17.993 · romaneio 71 · rastro_ponto 14.917 · auth.users 99.

**O DNS** (medido em 07/11): `api.pulsoline.grupoafline.com.br` A com TTL **14400 (4 h)** na
HostGator; `afline.alissonia.cloud` 4 h e `n8n.alissonia.cloud` 5 min, na conta do **Alisson**.
`pulsoline.grupoafline.com.br` (site) é da Cloudflare e **não muda**. O app e a extensão usam o nome
`api.pulsoline`, não o IP: voltam sozinhos quando o DNS virar.

**A ordem na noite:**
1. TTL do `api.pulsoline` para 300 na HostGator (e o Alisson nos dele) — **4 h antes** da troca do IP.
2. Avisar o Alisson que o n8n para.
3. Último técnico encerrado → `copia-para-mudanca.sh fria` (o sistema PARA aqui) → baixar para o PC →
   `sha256sum -c SHA256SUMS` no PC. **Só com a conferência OK** se clica em reinstalar.
4. hPanel da VPS **erp** (conferir o título — não a `gestao`) → Alterar localização → **Campinas**,
   Ubuntu 26.04 limpo, senha do root pelo Emanuel. A chave SSH (`~/.ssh/id_ed25519.pub` do Emanuel) volta pela API
   (`vps_ssh-keys_add-virtual-machine`, que só acrescenta).
5. Subir a cópia para a máquina nova e rodar `volta-depois-da-mudanca.sh`.
6. Antes do DNS: testar com `curl --resolve api.pulsoline.grupoafline.com.br:443:<IP novo>` e as duas
   portas do portal da Claro (`35.174.77.4` e `100.25.108.9`) a partir da máquina nova.
7. Trocar o IP na HostGator (e o Alisson nos dele). Conferir site, app, as baterias
   (`testar_policies`, `testar_campo`), `perm-conferir.sql`, a extensão no Chromium, o n8n.
8. Trocar o IP na documentação e no atalho `Paineis da VPS.bat`; voltar o TTL para 14400.

### Como foi (07/11/2026, 18h58–19h50 em Manaus)

| Hora (Manaus) | O quê |
|---|---|
| 18h51 | cópia **quente** (ensaio): 1,3 GB em 1 min 21 s, baixada em 3 min 39 s, sha256 OK |
| 18h58 | **sistema parado** — cópia **fria**: 1,7 GB em 1 min 34 s; baixada em 5 min 47 s; sha256 OK |
| 19h07 | TTL do `api.pulsoline` 14400 → **300** na HostGator (cPanel do `br244`, Zone Editor) |
| ~19h15 | o Emanuel clica em Alterar localização → **Campinas** no hPanel (reinstala) |
| 19h22 | máquina nova no ar, **IP `187.41.127.166`**; impressão SSH diferente = disco novo de verdade |
| 19h28 | chave SSH pela API (`vps_ssh-keys_add-virtual-machine`); Docker do Ubuntu; 17 imagens pelo digest em 1 min 31 s (IDs iguais aos de Boston) |
| 19h31 | cópia sobe do PC em 2 min 37 s; `volta-depois-da-mudanca.sh` monta tudo em ~1 min |
| 19h32 | **contagens idênticas à cópia fria**; 17 containers saudáveis; baterias 33/33 e 29/29; 0 tabela sem RLS; 0 definer aberta ao anon; 6/6 jobs do pg_cron; portas internas fechadas por fora |
| 19h40 | `api.pulsoline` e `erp.grupoafline.com.br` → `187.41.127.166` na HostGator; Google, Cloudflare e OpenDNS já respondem o novo |

No ar de novo: ~45 min de sistema parado. Ficou no PC: `C:\Users\Emanu\backup-vps-erp\` (as duas cópias e o
atalho antigo). Na VPS nova, a cópia fria continua em `/root/volta/` (só root) — apagar quando firmar.

**O portal da Claro NÃO abriu de Campinas** — o motivo da mudança. As duas portas (`35.174.77.4` e
`100.25.108.9`) respondem 500 com a página **"The URL you requested has been blocked"** do FortiGuard. O
certificado é o verdadeiro da Claro (Sectigo, `*.claro.com.br`) e o nome por trás é
`fwebvirg-…elb.us-east-1.amazonaws.com`: é o **FortiWeb da própria Claro** recusando este IP. Do PC do
Emanuel, no mesmo minuto, as duas abrem (200 e 401). O TOA (`clarobrasil.fs.ocs.oraclecloud.com`) abre da
VPS normalmente. Em Boston metade abria; em Campinas, nada. Ver D-341.

**O navegador agora é o Microsoft Edge** (pedido do Emanuel): `/opt/edge`, linuxserver/msedge
`157.0.4341.42-1-ls214`, mesma porta 3001 só local, teto de 3 GB. A extensão foi copiada para
`/opt/edge/config/extensao-toa`. Os logins do Chromium não passam (cada navegador cifra os cookies com a
própria chave): **entrar de novo no TOA e no PulsoLine e carregar a extensão** (`edge://extensions` → modo
de desenvolvedor → carregar sem compactação → `/config/extensao-toa`). O Chromium foi **apagado** a pedido
dele (container, imagem e `/opt/navegador`); o perfil antigo só existe na cópia do PC.

**Corrige o que estava escrito:** a Hostinger mostra **"Cronograma de backup: Semanalmente"** nesta VPS —
existe backup semanal deles (não diário, e é o deles, não o nosso).

**Falta (07/11, noite):**
- `alissonia.cloud` (conta Hostinger do Alisson): `@`, `gestao`, `afline` e `n8n` ainda apontam para
  `179.197.82.110`. Até trocar, **o n8n e o painel do Alisson ficam fora** (a nossa API não depende disso).
  A troca pela API foi barrada pelo filtro de segurança do Claude Code; o Emanuel troca no hPanel ou libera.
  O `@` tem também um AAAA `2a02:4780:95:7fd4::1` — conferir de quem é; o IPv6 da VPS nova é
  `2a02:4780:c6:352d::1`.
- Nome do host no hPanel: voltou `srv2098432.hstgr.cloud`; pôr `erp.grupoafline.com` de novo (só rótulo).
- Logar o Edge (TOA, PulsoLine) e carregar a extensão; dar ↻ e ver a rota e a varredura voltarem.
- TTL do `api.pulsoline` de volta para 14400 quando firmar (1–2 dias).
- O portal da Claro: decidir o caminho (D-341).

### O túnel do portal pelo celular (07/11/2026, 21h)

**Funciona.** O portal da Claro abre pela VPS através do celular do Emanuel (Galaxy S26 Ultra), que é
a "saída" (exit node) de uma rede privada **Tailscale** (conta emanuel.systembox@gmail.com, plano grátis).
Medido de dentro do Edge da VPS: portal **200** (3/3), API do sinal **401** (responde, pede login),
`ipc.claro.com.br` **200**; a Claro vê o acesso vindo de **Manaus, Telefônica/Vivo** (o celular).
Qualquer outro endereço continua saindo direto pela VPS (`187.41.127.166`).

| Peça | Onde |
|---|---|
| Porteiro Tailscale (`tailscale/tailscale:v1.104.4`, userspace, proxy HTTP `:1055` só na rede `edge_default`) | `/opt/tunel-portal` · aparelho `vps-erp-portal` (`100.77.118.27`) · compose em `scripts-vps/tunel-portal-docker-compose.yml` |
| Regra do Edge: `*.clarobrasil.mobi` e `ipc.claro.com.br` → `PROXY tunel-portal:1055`; o resto `DIRECT` | `EDGE_CLI=--proxy-pac-url=data:…` em `/opt/edge/docker-compose.yml` |
| A saída | `s26-ultra-de-emanuel` (`100.90.74.34`), app Tailscale com "Run as exit node", aprovado no painel (Edit route settings → Use as exit node) |

**Armadilha resolvida na montagem:** o `containerboot` da imagem espera o login só 60 s, desiste, reinicia e o
link aberto passa a valer para um aparelho que já não existe (3 reinícios). O compose roda o `tailscaled`
direto; o login é `docker exec tunel-portal tailscale up --hostname=vps-erp-portal --accept-dns=false`, uma vez.

**Limites:** celular desligado, sem sinal, em modo avião ou com outra VPN ligada = o portal não abre pela VPS
(o TOA e o resto continuam). O app Tailscale fica em "Não restrito" na bateria. Trocar de aparelho:
`docker exec tunel-portal tailscale set --exit-node=<aparelho>`. A liberação do IP pela Claro (D-341)
continua sendo o caminho sem dependência — o Emanuel não tem contato lá hoje.

**12/11/2026 — a saída passou a ser um PC.** O celular saía da rede ("selected but offline") e o portal caía
junto. O Emanuel ligou um PC Windows que fica ligado: `desktop-oqlhjsd` (`100.101.182.52`), Tailscale 1.104.6,
"Run exit node" no ícone e "Use as exit node" aprovado no painel. Na VPS:
`docker exec tunel-portal tailscale set --exit-node=desktop-oqlhjsd` (gravado em `/opt/tunel-portal/estado`,
sobrevive a reinício). Medido de dentro do Edge, **um pedido só**: a Claro vê **Manaus, AS28573 Claro NXT**
(internet residencial, `179.222.121.137`) e o portal respondeu **200** em 1,2 s. A ligação vai por relé do
Tailscale (DERP São Paulo, ~88 ms), não direta — basta para o ritmo da extensão (D-342).
- **O celular ficou de reserva:** se o PC cair, `tailscale set --exit-node=s26-ultra-de-emanuel`.
- **O PC precisa:** ficar ligado, sem suspender, com internet, e com "Run unattended" no Tailscale.
- **A chave do PC vence em 11/05/2027** (a do celular em 07/05/2027): sem "Disable key expiry" no painel, o
  túnel para nessa data até alguém logar de novo.
- **O risco da D-342 agora é dessa internet:** se o FortiWeb da Claro bloquear o IP por rajada, quem usa a mesma
  conexão do PC fica sem o portal até o bloqueio passar. Não diagnostique o portal em rajada pelo túnel.
