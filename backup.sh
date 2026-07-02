#!/usr/bin/env bash
# Nightly backup: database dump + uploaded files, kept for 14 days.
# Install as a cron job (crontab -e):
#   0 3 * * * /opt/portal/backup.sh >> /opt/portal/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"

BACKUP_DIR="./backups"
STAMP="$(date +%F)"
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Backing up database…"
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U portal portal | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[$(date)] Backing up uploads…"
tar czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C . uploads

echo "[$(date)] Pruning backups older than 14 days…"
find "$BACKUP_DIR" -name "*.gz" -mtime +14 -delete

echo "[$(date)] Done. Current backups:"
ls -lh "$BACKUP_DIR" | tail -5
