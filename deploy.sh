#!/usr/bin/env bash
# Deploy the latest code on the VPS. Run from /opt/portal:
#   ./deploy.sh
# Or from your Mac:
#   ssh deploy@YOUR_VPS_IP '/opt/portal/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Pulling latest code…"
git pull --ff-only

echo "→ Rebuilding and restarting the app…"
docker compose -f docker-compose.prod.yml up -d --build app

echo "→ Cleaning up old images…"
docker image prune -f

echo "✓ Deployed. Tail logs with:"
echo "  docker compose -f docker-compose.prod.yml logs -f app"
