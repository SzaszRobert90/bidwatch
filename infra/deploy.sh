#!/usr/bin/env bash
# Pull-deploy: the server pulls git (config) and ghcr (images); it never builds.
#   prod image : ghcr.io/szaszrobert90/bidwatch-worker:prod   (release.yml: dispatch or v* tag)
#   dev image  : ghcr.io/szaszrobert90/bidwatch-worker:dev    (ci.yml: every push to main)
set -euo pipefail
cd /opt/bidwatch

GIT_MOVED=0
git fetch -q origin main || true
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git pull -q --ff-only origin main
  GIT_MOVED=1
  echo "$(date -Is) git -> $(git rev-parse --short origin/main)"
fi
cd infra

# ---- prod (live scraping stack) ----
PROD_IMAGE="ghcr.io/szaszrobert90/bidwatch-worker:prod"
OLD_PROD=$(docker image inspect "$PROD_IMAGE" --format '{{.Id}}' 2>/dev/null || echo none)
BIDWATCH_IMAGE_TAG=prod docker compose -p bidwatch --profile prod pull --quiet
NEW_PROD=$(docker image inspect "$PROD_IMAGE" --format '{{.Id}}' 2>/dev/null || echo none)
if [ "$OLD_PROD" != "$NEW_PROD" ] || [ "$GIT_MOVED" = "1" ]; then
  echo "$(date -Is) deploying prod"
  BIDWATCH_IMAGE_TAG=prod docker compose -p bidwatch --profile prod up -d --remove-orphans
  echo "$(date -Is) prod deployed"
fi

# ---- dev (fixture-replay stack, internal-only, second compose project) ----
DEV_IMAGE="ghcr.io/szaszrobert90/bidwatch-worker:dev"
OLD_DEV=$(docker image inspect "$DEV_IMAGE" --format '{{.Id}}' 2>/dev/null || echo none)
BIDWATCH_IMAGE_TAG=dev docker compose -p bidwatch-dev --profile dev -f compose.yml -f compose.dev.yml pull --quiet
NEW_DEV=$(docker image inspect "$DEV_IMAGE" --format '{{.Id}}' 2>/dev/null || echo none)
if [ "$OLD_DEV" != "$NEW_DEV" ] || [ "$GIT_MOVED" = "1" ]; then
  echo "$(date -Is) deploying dev"
  DC="docker compose -p bidwatch-dev --profile dev -f compose.yml -f compose.dev.yml"
  BIDWATCH_IMAGE_TAG=dev $DC up -d minio elasticmq minio-init
  sleep 3
  BIDWATCH_IMAGE_TAG=dev $DC run --rm feeder-dev
  BIDWATCH_IMAGE_TAG=dev $DC run --rm worker-dev
  echo "$(date -Is) dev deployed (fixture replay green)"
fi

docker image prune -f >/dev/null
echo "$(date -Is) deploy pass done"
