#!/bin/bash
# ┌─ Cópia de TUDO da VPS erp antes de reinstalar em Campinas (07/11/2026) ─┐
# │ A "Alterar localização" da Hostinger REINSTALA o servidor: o disco é    │
# │ apagado. Não há backup. Esta cópia é a única volta — ela vai para o PC  │
# │ do Emanuel e é conferida (sha256) ANTES de alguém clicar em reinstalar. │
# │                                                                          │
# │   quente  — com tudo no ar (ensaio + cópia de segurança). O banco vai    │
# │             só pelo pg_dumpall; a pasta de dados dele fica de fora,      │
# │             porque copiada com o banco escrevendo sai inconsistente.     │
# │   fria    — na hora H. Para as telas/API, faz o dump com os bancos       │
# │             quietos, PARA TUDO e copia também a pasta de dados crua      │
# │             (volta idêntica, na mesma imagem do Postgres).               │
# │                                                                          │
# │ Depois da fria o sistema fica PARADO. Para religar sem reinstalar:       │
# │   docker start $(docker ps -aq)                                          │
# └──────────────────────────────────────────────────────────────────────────┘
set -euo pipefail
MODO=${1:-}
[ "$MODO" = quente ] || [ "$MODO" = fria ] || { echo "uso: $0 quente|fria"; exit 1; }

DEST=/root/mudanca/$(date -u +%Y%m%d-%H%M)-$MODO
mkdir -p "$DEST"; chmod 700 /root/mudanca "$DEST"; cd "$DEST"
log(){ echo "[$(date -u +%H:%M:%S) UTC] $*"; }

# ── 1. Inventário: o que rodava, em que versão exata ────────────────────────
log "inventario"
{
  echo "== maquina";      hostnamectl; cat /etc/os-release | head -3
  echo "== containers";   docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  echo "== compose";      docker compose ls -a
  echo "== imagens (digest exato — use para baixar a MESMA versao)"
  for i in $(docker images -q | sort -u); do
    echo "$(docker image inspect --format '{{join .RepoTags ","}}  {{index .RepoDigests 0}}' "$i")"
  done
  echo "== volumes";      docker volume ls
  echo "== pacotes docker"; dpkg -l | grep -Ei 'docker|containerd|compose' | awk '{print $2, $3}'
  echo "== firewall";     ufw status verbose
  echo "== portas";       ss -tlnp
  echo "== crontab root"; crontab -l 2>&1 || true
  echo "== pg_cron";      docker exec supabase-db psql -U postgres -d postgres -Atc \
                            "select jobname, schedule, command from cron.job order by 1"
  echo "== tamanho dos bancos"
  docker exec supabase-db psql -U postgres -d postgres -Atc \
    "select datname, pg_size_pretty(pg_database_size(datname)) from pg_database"
  echo "== contagens de conferencia (comparar depois da volta)"
  docker exec supabase-db psql -U postgres -d postgres -Atc "
    select 'visita', count(*) from visita union all
    select 'ordem_servico', count(*) from ordem_servico union all
    select 'visita_evento', count(*) from visita_evento union all
    select 'evidencia', count(*) from evidencia union all
    select 'equipamento', count(*) from equipamento union all
    select 'romaneio', count(*) from romaneio union all
    select 'rastro_ponto', count(*) from rastro_ponto union all
    select 'auth.users', count(*) from auth.users union all
    select 'storage.objects', count(*) from storage.objects"
} > inventario.txt 2>&1

# ── 2. Fria: para quem escreve, deixa só os bancos de pé ────────────────────
if [ "$MODO" = fria ]; then
  log "parando tudo menos os bancos"
  for c in $(docker ps --format '{{.Names}}' | grep -vx -e supabase-db -e n8n-postgres-1); do
    docker stop "$c" >/dev/null
  done
fi

# ── 3. Bancos, lógico (papéis + todos os bancos) ────────────────────────────
log "pg_dumpall do Supabase"
docker exec supabase-db pg_dumpall -U supabase_admin | gzip -1 > supabase-pg_dumpall.sql.gz
log "pg_dumpall do n8n"
docker exec n8n-postgres-1 pg_dumpall -U n8n | gzip -1 > n8n-pg_dumpall.sql.gz

# ── 4. Fria: agora para os bancos também ────────────────────────────────────
EXCLUI_DADOS=()
if [ "$MODO" = fria ]; then
  log "parando os bancos"
  docker stop supabase-db n8n-postgres-1 >/dev/null
else
  # quente: a pasta crua do banco escrevendo nao serve — vai so o dump
  EXCLUI_DADOS=(--exclude=opt/supabase/volumes/db/data)
fi

# ── 5. Arquivos ─────────────────────────────────────────────────────────────
# /opt: Supabase (.env com as chaves, compose, Storage com fotos e videos,
# funcoes), n8n + Caddyfile, dashboard, navegador (perfil do Chromium com a
# extensao e os logins), portainer, monitor.
log "tar /opt"
tar -C / -cf - --exclude=opt/containerd "${EXCLUI_DADOS[@]}" opt | gzip -1 > opt.tar.gz

# Volumes nomeados do Docker. Fica de fora: netdata (historico de grafico,
# 1,2 GB, refaz sozinho) e deno-cache (refaz sozinho).
VOLS=(n8n_n8n_data n8n_caddy_data n8n_caddy_config portainer_portainer_data supabase_db-config)
[ "$MODO" = fria ] && VOLS+=(n8n_postgres_data)
log "tar volumes: ${VOLS[*]}"
tar -C /var/lib/docker/volumes -czf volumes.tar.gz "${VOLS[@]}"

# Sistema: chaves SSH de entrada (inclusive a do celular), chaves do
# servidor (o fingerprint continua o mesmo), sshd, firewall, repositorio do
# Docker, /root (scripts e copias antigas).
log "tar sistema"
tar -C / -czf sistema.tar.gz --exclude=root/mudanca --ignore-failed-read \
  root etc/ssh etc/hosts etc/hostname etc/ufw etc/docker etc/default/ufw \
  etc/apt/sources.list.d etc/apt/keyrings etc/fstab etc/sysctl.conf etc/sysctl.d

# ── 6. Conferência ──────────────────────────────────────────────────────────
log "sha256"
sha256sum *.gz inventario.txt > SHA256SUMS
gzip -t supabase-pg_dumpall.sql.gz n8n-pg_dumpall.sql.gz
ls -la
du -sh .
log "pronto: $DEST"
[ "$MODO" = fria ] && log "SISTEMA PARADO. Para religar sem reinstalar: docker start \$(docker ps -aq)"
exit 0
