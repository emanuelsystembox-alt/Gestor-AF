#!/bin/bash
# Boletim do dia com IA (migration 265) — chamado pelo cron do host (/etc/cron.d/afline-boletim).
# O banco já preparou o boletim por regra; aqui só se tenta o texto da IA. Um por vez (flock):
# uma chamada lenta não empilha com a próxima rodada do cron.
set -u
exec 9>/run/lock/afline-boletim.lock
flock -n 9 || exit 0
/usr/bin/python3 -I /opt/afline/boletim/boletim.py >> /var/log/afline-boletim.log 2>&1
