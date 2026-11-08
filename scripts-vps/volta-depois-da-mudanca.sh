#!/bin/bash
# ┌─ Volta da VPS erp depois da reinstalação em Campinas (07/11/2026) ──────┐
# │ Roda na máquina NOVA (Ubuntu 26.04 limpo), como root, numa pasta com a   │
# │ cópia FRIA feita por copia-para-mudanca.sh:                              │
# │   opt.tar.gz  volumes.tar.gz  sistema.tar.gz  SHA256SUMS                 │
# │   supabase-pg_dumpall.sql.gz  n8n-pg_dumpall.sql.gz  inventario.txt      │
# │                                                                          │
# │ Volta a pasta crua do banco (mesma imagem supabase/postgres:17.6.1.136): │
# │ fica idêntica, com papéis, grants, pg_cron e auth. O pg_dumpall é o      │
# │ plano B, se a pasta crua não subir.                                      │
# │                                                                          │
# │ --numeric-owner em TODA extração: a pasta do banco é do uid 100 (o       │
# │ postgres de dentro do container). Numa máquina nova o uid 100 pode ter   │
# │ outro nome, e o tar sem essa opção troca o dono pelo NOME — o Postgres   │
# │ não abre a própria pasta.                                                │
# └──────────────────────────────────────────────────────────────────────────┘
set -euo pipefail
COPIA=${1:?uso: $0 /caminho/da/copia-fria}
cd "$COPIA"
log(){ echo "[$(date -u +%H:%M:%S) UTC] $*"; }

log "conferindo a copia"
sha256sum -c SHA256SUMS
grep -q -- '-fria' <<<"$COPIA" || { echo "isto nao parece a copia FRIA — pare"; exit 1; }

# ── 1. Docker (pacotes do Ubuntu: nada de setup.sh, que troca o Docker) ─────
log "instalando docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 ufw
systemctl enable --now docker

# ── 2. Sistema: nome, chaves SSH (o fingerprint continua o mesmo), sshd ─────
log "sistema"
mkdir -p /root/volta-sistema
tar -C /root/volta-sistema --numeric-owner -xzf sistema.tar.gz
hostnamectl set-hostname erp
install -m 600 /root/volta-sistema/root/.ssh/authorized_keys /root/.ssh/authorized_keys
cp -a /root/volta-sistema/etc/ssh/ssh_host_* /etc/ssh/
cp -a /root/volta-sistema/etc/ssh/sshd_config.d/. /etc/ssh/sshd_config.d/
systemctl restart ssh
# /root antigo (scripts, copias-almox, migracao) fica em /root/volta-sistema/root

# ── 3. Firewall: o mesmo de antes (22, 80, 443). O resto escuta só em 127.0.0.1
log "firewall"
ufw default deny incoming; ufw default allow outgoing
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp
ufw --force enable

# ── 4. /opt inteiro (Supabase com o banco cru e o Storage, n8n, navegador…) ─
log "extraindo /opt"
tar -C / --numeric-owner -xzf opt.tar.gz
stat -c '%u:%g %n' /opt/supabase/volumes/db/data   # tem de ser 100:0

# ── 5. Volumes nomeados — criados com o rótulo do compose, depois enchidos ──
log "volumes"
cria(){ docker volume create --label com.docker.compose.project="$1" \
          --label com.docker.compose.volume="$2" "${1}_$2" >/dev/null; }
cria n8n n8n_data; cria n8n caddy_data; cria n8n caddy_config; cria n8n postgres_data
cria portainer portainer_data; cria supabase db-config
tar -C /var/lib/docker/volumes --numeric-owner -xzf volumes.tar.gz

# ── 6. Imagens com etiqueta que anda (stable, 2-alpine, 16-alpine): baixa a ──
#      MESMA versão pelo digest guardado e põe a etiqueta de volta.
log "imagens pelo digest"
mesma(){ docker pull -q "$2" >/dev/null && docker tag "$2" "$1"; }
mesma docker.n8n.io/n8nio/n8n:stable \
  docker.n8n.io/n8nio/n8n@sha256:942bc274709f27f99f7c6024a785d8e8f75ac06838cabcba448abb8d9127ec7b
mesma postgres:16-alpine \
  postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab
mesma caddy:2-alpine \
  caddy@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f

# ── 7. Subir, na ordem: o Supabase cria a rede que o Caddy do n8n usa ───────
log "subindo supabase"
(cd /opt/supabase && docker compose up -d)
for i in $(seq 1 60); do
  docker exec supabase-db pg_isready -U postgres -q 2>/dev/null && break; sleep 5
done
log "subindo n8n (caddy), edge, portainer, monitor"
(cd /opt/n8n       && docker compose up -d)
(cd /opt/edge      && docker compose up -d)
(cd /opt/portainer && docker compose up -d)
(cd /opt/monitor   && docker compose up -d)

# ── 8. Conferência: as mesmas contagens do inventário ──────────────────────
log "contagens (comparar com o fim do inventario.txt)"
docker exec supabase-db psql -U postgres -d postgres -Atc "
  select 'auth.users', count(*) from auth.users union all
  select 'romaneio', count(*) from romaneio union all
  select 'evidencia', count(*) from evidencia union all
  select 'storage.objects', count(*) from storage.objects union all
  select 'rastro_ponto', count(*) from rastro_ponto union all
  select 'equipamento', count(*) from equipamento union all
  select 'ordem_servico', count(*) from ordem_servico union all
  select 'visita', count(*) from visita union all
  select 'visita_evento', count(*) from visita_evento"
sed -n '/== contagens/,$p' inventario.txt
docker exec supabase-db psql -U postgres -d postgres -Atc \
  "select count(*) || ' jobs do pg_cron' from cron.job"
docker ps --format '{{.Names}}\t{{.Status}}'
log "pronto. Falta: DNS para o IP novo, baterias, teste do portal da Claro (docs/12)"
