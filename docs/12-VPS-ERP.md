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
| Provedor | Hostinger, plano KVM 2 (id 2098432), datacenter **Boston (EUA)** |
| Recursos | 2 vCPU · 8 GB RAM · 100 GB disco |
| Sistema | Ubuntu 26.04.1 LTS |
| IP | `179.197.82.110` (reverso `srv2098432.hstgr.cloud`) |
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
| `/opt/navegador` | Chromium (linuxserver/chromium `2dba585f-ls60`) visto pela web | 3001, **só local** | 29/10 |
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
ssh -L 3001:127.0.0.1:3001 -L 9443:127.0.0.1:9443 -L 8000:127.0.0.1:8000 -L 19999:127.0.0.1:19999 root@179.197.82.110
```

Com o túnel aberto: **https://localhost:3001** (navegador),
**https://localhost:9443** (Portainer), **http://localhost:8000** (Studio do
Supabase — usuário e senha em `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` do
`/opt/supabase/.env`) e **http://localhost:19999** (monitoramento). O aviso de certificado é esperado — o
certificado é do próprio container, e a conexão já vai dentro do SSH.

**O túnel é só a janela.** Fechar a aba, o túnel ou desligar o PC não fecha o
Chromium: ele continua aberto na VPS, com abas e logins (perfil em
`/opt/navegador/config`).

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
