#!/usr/bin/env bash
# Pull-deploy: if origin/main moved, pull and rebuild the live stack.
# GitHub's cloud runners cannot SSH into the LAN, so the container pulls instead.
# Upgrade path: Tailscale on the runner -> SSH deploy workflow (see README).
set -euo pipefail
cd /opt/bidwatch

git fetch -q origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "$(date -Is) deploying $REMOTE"
git pull -q --ff-only origin main
cd infra
docker compose --profile prod up -d --build --quiet-pull
docker image prune -f >/dev/null
echo "$(date -Is) deployed"
