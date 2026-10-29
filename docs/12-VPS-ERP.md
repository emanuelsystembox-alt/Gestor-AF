# A VPS `erp.grupoafline.com` — um computador ligado 24 h fora da AFLINE

**Situação em 29/10/2026: montada, sem uso no projeto ainda.** Nada do Gestor
AF roda nela. Este documento existe para a próxima conversa começar do que já
está pronto, e não do zero.

> **Por que uma VPS, se o banco e a web já estão na nuvem?** O Supabase e a
> Cloudflare guardam dado e servem tela; não deixam um **navegador** aberto. A
> extensão do TOA (D-193) só trabalha dentro de um Chrome ligado e logado — hoje,
> o Chrome da máquina do Emanuel. A VPS é a candidata a ser esse Chrome sem
> depender de ninguém deixar o PC ligado. **Ainda não foi decidido** (ver
> "Em aberto").

## A máquina

| | |
|---|---|
| Provedor | Hostinger, plano KVM 2 (id 2098432) |
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
ssh -L 3001:127.0.0.1:3001 -L 9443:127.0.0.1:9443 root@179.197.82.110
```

Com o túnel aberto: **https://localhost:3001** (navegador) e
**https://localhost:9443** (Portainer). O aviso de certificado é esperado — o
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
