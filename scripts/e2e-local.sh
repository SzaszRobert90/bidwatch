#!/usr/bin/env bash
# Host-mode e2e: compose up (minio + elasticmq), then feeder -> worker -> report
# in fixture mode straight from the host (fast; no docker image build).
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_ACCESS_KEY_ID=bidwatchlocal
export AWS_SECRET_ACCESS_KEY=bidwatchlocal-secret
export AWS_REGION=us-east-1
export BIDWATCH_S3_ENDPOINT=http://localhost:9000
export BIDWATCH_SQS_ENDPOINT=http://localhost:9324
export BIDWATCH_QUEUE_URL=http://localhost:9324/queue/bidwatch-main
export BIDWATCH_DLQ_URL=http://localhost:9324/queue/bidwatch-dlq
export BIDWATCH_MODE=fixture
export BIDWATCH_POLITENESS_MS=0
export BIDWATCH_S3_USE_SSL=false

echo "== starting minio + elasticmq"
docker compose -f infra/compose.yml up -d --quiet-pull minio minio-init elasticmq
for i in $(seq 1 30); do
  if curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 3  # minio-init creates the buckets

echo "== feeder (fixture)"
npx tsx src/apps/feeder/main.ts --once

echo "== worker (fixture)"
npx tsx src/apps/worker/main.ts --once

echo "== transform (bronze -> silver -> gold)"
npx tsx src/apps/transform/main.ts

echo "== report"
npx tsx src/apps/report/main.ts

echo "== e2e OK"
