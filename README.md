# bidwatch

Brand-bidding monitor with **affiliate attribution**. Watches search results for
brand keywords, classifies every ad, follows its landing redirect chain, and
matches against an affiliate-network signature database — turning "an ad
appeared" into an evidence pack: *network + publisher + redirect chain + date*.

TypeScript. AWS-shaped (SQS queue, S3 lake, ECS-style worker container) but
runs on the homelab today via MinIO + ElasticMQ; migrating to real AWS later is
an environment change, not a rewrite. Design doc:
[docs/specs/2026-09-09-bidwatch-design.md](docs/specs/2026-09-09-bidwatch-design.md).

## How a catch works

```
feeder (cron) ─▶ queue ─▶ worker ─▶ SerpProvider (Bing, real Chrome)
                                    ├─▶ LandingInspector (redirect chain)
                                    ├─▶ signature DB match (params/domains/disclosure)
                                    └─▶ S3: raw/ + curated/ JSONL
report app (DuckDB over the lake) ─▶ per-brand evidence packs + prospect ranking
```

Classification: `self_bid` (brand's own domain — noise) · `affiliate_violation`
(signature match → reportable) · `competitor_conquest` (third party, no
signature — competitive intel) · `unknown` (landing blocked).

## Reality of scraping Bing ads (learned the hard way, see scripts/probe-*.ts)

- Bing injects ads **client-side**; plain HTTP (even curl-impersonate TLS) never sees them.
- Ads appear only for **trusted sessions**: real Chrome binary (not bundled chromium),
  **headful**, persistent warm profile.
- The search URL must be **vanilla** (`/search?q=...` only) — `mkt`/`count` params on a
  mismatched IP read as automation and suppress ads entirely.
- Signed `aclick` landing URLs expire within the hour — inspect immediately.
- Ad availability fluctuates per auction/session; zero-ad runs are valid data.
- EU vantage points need the consent banner accepted (the worker does this automatically).

## Layout

```
src/domain/       types + ports (SerpProvider, LandingInspector, JobQueue, ResultStore)
src/adapters/     bing-playwright, bing-http, landing inspector, sqs, s3, fixtures
src/apps/         worker, feeder, report (DuckDB), prospect-builder (v1.5 stub)
config/           brands.yaml (watched brands), signatures.yaml (affiliate networks)
fixtures/         recorded SERP HTML + landing chains — dev/CI replays, never hits Bing
infra/            compose.yml, elasticmq.conf, Dockerfile (chrome + xvfb)
scripts/          probes, fixture recording, e2e
```

## Run locally

```bash
npm ci

# WSL users: after any `npm ci`, run `bash scripts/wsl-setup.sh` once —
# it adds the linux native binaries next to the windows ones so one
# node_modules works from both (the `bidwatch` alias does this automatically).
npm test                      # unit (no network)
bash scripts/e2e-local.sh     # compose up minio+elasticmq, fixture run end to end
npm run feeder -- --once      # feed live jobs (needs .env, see .env.example)
npm run worker -- --once
npm run report
npx tsx scripts/record-fixtures.ts   # refresh live fixtures (opens Chrome)
```

## Deployment

GitHub pushes artifacts; the homelab only pulls. Nothing builds on the server.

```
push to main ───▶ CI: test → integration → docker
                      └────────▶ publish  ghcr.io/szaszrobert90/bidwatch-worker:dev
dispatch / tag v* ─▶ release.yml ─▶ publish …:prod          (the prod "gate")
mirror-images.yml ─▶ minio/mc/elasticmq copied into our ghcr (upstream-proof)
```

The homelab LXC runs `bidwatch-deploy.timer` (every 10 min, `infra/deploy.sh`):
`git pull` for config, `docker compose pull` for images, then
- **prod stack** (`-p bidwatch`, live scraping, cron 06:00) runs `:prod`
- **dev stack** (`-p bidwatch-dev`, fixture replay, internal-only networking) runs `:dev`

Server auth: one ghcr login for the deploy user (packages-read token).
Local auth: `gh auth refresh -s read:packages,write:packages`, then
`docker login ghcr.io -u szaszrobert90 -p "$(wsl -e bash -lc 'gh auth token')"`.

## Environments

- `dev` (push to main): CI → tests → deploy to homelab with `BIDWATCH_MODE=fixture`.
- `prod` (manual, **approval-gated** GitHub environment): deploy live scraping on cron.

Phase 2 (AWS): create account → OIDC bootstrap → CDK stacks (S3, SQS+DLQ,
EventBridge, ECR + Fargate, t4g.micro analytics) → flip endpoints in env. No code change.
