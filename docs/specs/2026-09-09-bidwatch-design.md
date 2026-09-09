# bidwatch — design spec (2026-09-09)

Brand-bidding monitor with affiliate attribution. Homelab-first, AWS-shaped, $0.

## Problem

Affiliates bid on brand keywords in search ads and divert sales the brand would
have gotten organically, earning a commission on them. Competitors bid on brand
names and inflate the brand's own CPCs. Brands with affiliate programs (and the
agencies/networks that police them) pay for evidence of this. Commercial
category: BrandVerity, Marcode, The Search Monitor, Adthena.

## Core insight

"An ad appeared near a brand keyword" is not a catch. The catch is
**attribution**: follow the ad's landing URL through its redirect chain and
match against a database of affiliate-network signatures (tracking params,
tracker domains, disclosure phrases). A match yields network + publisher ID —
an evidence pack an affiliate manager can act on.

Classification per observed ad:

| class | meaning |
|---|---|
| `self_bid` | ad domain is the brand's own domain — noise, filtered |
| `affiliate_violation` | signature match → reportable finding |
| `competitor_conquest` | third-party domain, no signature — competitive intel |
| `unknown` | landing unreachable/blocked — retried sparingly |

## Decisions (locked with owner)

- **Engine:** Bing live scraping now ($0); Google is the end goal. `SerpProvider`
  is a port; future adapters: Google Ads Transparency Center scraper (free,
  verified advertiser names), paid SERP API.
- **Location:** everything on the Proxmox homelab now; AWS later via CDK.
- **Analytics v1:** DuckDB over the data lake + scheduled CSV/markdown reports.
  No UI, no alerting.
- **AWS:** no account yet. All AWS interaction via `@aws-sdk/*` with
  service-specific endpoint env vars (`AWS_ENDPOINT_URL_S3`, `AWS_ENDPOINT_URL_SQS`)
  → MinIO/ElasticMQ locally, real AWS later, zero code change.
- **Dev/prod:** GitHub Actions environments; dev replays committed fixtures
  (never touches Bing), prod scrapes live on cron; prod deploys gated by
  required-reviewer approval.

## Architecture

```
feeder (cron) ──▶ queue (SQS/ElasticMQ) ──▶ worker (Docker, ECS-shaped)
                                                ├─▶ SerpProvider (bing-http adapter)
                                                ├─▶ LandingInspector (redirect chain + signature DB)
                                                └─▶ ResultStore (S3/MinIO): raw/ + curated/ JSONL
report app (cron): DuckDB (httpfs) over MinIO ─▶ findings, prospect ranking ─▶ reports/
```

### Data model

- `serp_observations` — run_id, brand, keyword, geo, engine, position, ad title,
  display URL/domain, click URL.
- `landing_inspections` — run_id, ad key, request URL, redirect chain (hop,
  status, URL), final URL, http status, matches[].
- `findings` — observation ⟕ inspection → classification + evidence chain.
- `prospects` — brand registry + ranking (violations × program presence).

### Storage layout (S3/MinIO)

- `bidwatch-raw`: `raw/engine=bing/dt=YYYY-MM-DD/run=<jobId>/serp.html.gz` + `meta.json`
- `bidwatch-curated`: `curated/observations/dt=<date>/run=<jobId>.jsonl`,
  `curated/landings/dt=<date>/run=<jobId>.jsonl`
- `bidwatch-reports`: `reports/YYYY-MM-DD/<brand>.md`, `prospect-ranking-<date>.csv`

### Signature DB

`config/signatures.yaml` — data, not code. Kinds: query param (exact name +
optional value pattern, e.g. Impact `irgwc`, ShareASale `sscid`, Awin `awc`,
CJ `cid`, Rakuten `ranMID`), tracker domain (suffix match, e.g. awin1.com,
qksrv.net, prf.hn, linksynergy.com, pxf.io), body regex (disclosure phrases).
New network = config change, no deploy.

### Ports (src/domain)

`SerpProvider` · `LandingInspector` · `JobQueue` (ensureQueues/send/receive/delete) ·
`ResultStore` (putObject/putJson/putGzip) — adapters in `src/adapters`, apps in
`src/apps` (worker, feeder, report, prospect-builder[v1.5 stub]).

### Playwright

Not installed in v1. Bing serves full HTML to plain fetch with a desktop UA;
if that stops being true, add a `bing-playwright` adapter behind the existing
port. Proxy support: `BIDWATCH_PROXIES` (comma list, round-robin, default off).

## Honest limits

Single home-geo vantage point. Bing-only until the Google adapter lands.
Google keyword bids are private — findings are inference; the evidence is the
landing chain. Low-volume polite crawling (standard UA, 1 fetch/ad/run,
sparing retries); Bing ToS-gray at any volume — accepted at this scale.
Bing markup drift → fixtures + tests + raw layer retained for reparse.

## Phase 2 (deferred)

AWS account + OIDC bootstrap → CDK stacks (S3, SQS+DLQ, EventBridge Scheduler,
ECR + ECS Fargate worker, t4g.micro analytics) → endpoint/env flip.
Google: Transparency Center adapter, optionally paid SERP API.
