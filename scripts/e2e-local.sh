#!/usr/bin/env bash
# Host-mode e2e: compose up (minio + elasticmq + otel-lgtm), then N rounds of
# feeder -> worker in fixture mode straight from the host (fast; no docker
# image build), followed by one transform -> report. RUNS=N replays the
# pipeline N times so the Grafana dashboard at localhost:3000 has visible
# history instead of a single data point.
set -euo pipefail
cd "$(dirname "$0")/.."

RUNS="${RUNS:-1}"

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
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

echo "== starting minio + elasticmq + otel-lgtm"
docker compose -f infra/compose.yml up -d --quiet-pull minio minio-init elasticmq otel-lgtm
for i in $(seq 1 30); do
  if curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then break; fi
  sleep 1
done
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 3  # minio-init creates the buckets; grafana finishes provisioning

for run in $(seq 1 "$RUNS"); do
  echo "== feeder (fixture) — round $run/$RUNS"
  npx tsx src/apps/feeder/main.ts --once

  echo "== worker (fixture) — round $run/$RUNS"
  npx tsx src/apps/worker/main.ts --once
done

echo "== transform (bronze -> silver -> gold)"
npx tsx src/apps/transform/main.ts

echo "== report"
npx tsx src/apps/report/main.ts

echo "== e2e OK — dashboard: http://localhost:3000 (dashboards -> bidwatch)"
