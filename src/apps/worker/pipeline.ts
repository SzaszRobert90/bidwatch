import type { LandingInspector, ResultStore, SerpProvider } from "../../domain/ports.js";
import type { LandingRow, ObservationRow, SerpQuery, SignatureDb } from "../../domain/types.js";
import { classifyLanding, domainOf, isSelfBid } from "../../domain/domain.js";
import { resolveAclickTarget } from "../../domain/aclick.js";
import { matchSignatures } from "../../adapters/landing/match.js";
import { bidwatchMetrics } from "../../metrics.js";
import { withSpan } from "../../telemetry.js";

export interface PipelineDeps {
  provider: SerpProvider;
  inspector: LandingInspector;
  store: ResultStore;
  signatures: SignatureDb;
  rawBucket: string;
  curatedBucket: string;
  maxLandings: number;
  politenessMs: number;
  /** fixture|live — metric attribute separating replay from real traffic. */
  mode: string;
  log: (msg: string, ...rest: unknown[]) => void;
}

/**
 * Bing click URLs embed the advertiser's destination in a base64url `u` param.
 * Decode it, run the signature matcher over it, and merge the matches into the
 * inspection with source "ad_meta" — attribution evidence with zero extra
 * requests, immune to Bing's click guard.
 */
function attachAdMeta(signatures: SignatureDb, clickUrl: string, inspection: LandingRow["inspection"]): void {
  const destination = resolveAclickTarget(clickUrl);
  if (destination === null) return;
  inspection.adMetaUrl = destination;
  const matches = matchSignatures(signatures, { urls: [destination], body: null }).map(
    (m) => ({ ...m, source: "ad_meta" as const }),
  );
  inspection.matches.push(...matches);
}

/**
 * One queue job = one SERP fetch + landing inspections.
 * Raw layer keeps the full SERP HTML (gzipped) for reparse; curated layers
 * hold one JSONL row per ad observation and per landing inspection.
 * Each job is one `job.process` trace with children per landing — that trace
 * tree is the "what exactly happened in this run" view in Grafana.
 */
export async function processJob(deps: PipelineDeps, job: SerpQuery): Promise<void> {
  const metrics = bidwatchMetrics();
  return withSpan(
    "job.process",
    { run_id: job.runId, brand: job.brand, keyword: job.keyword, geo: job.geo, engine: job.engine },
    async (span) => {
      const startedAt = performance.now();
      const serp = await deps.provider.fetchSerp(job);
      metrics.serpDuration.record((performance.now() - startedAt) / 1000, { mode: deps.mode });
      metrics.ads.add(serp.ads.length, { mode: deps.mode });
      if (serp.httpStatus !== 200) {
        throw new Error(`serp http ${serp.httpStatus} for "${job.keyword}"${serp.notice ? ` (${serp.notice})` : ""}`);
      }
      if (serp.notice !== null) {
        deps.log(`notice for "${job.keyword}": ${serp.notice}`);
      }

      const dt = serp.fetchedAt.slice(0, 10);
      await deps.store.putGzip(`${deps.rawBucket}/raw/engine=bing/dt=${dt}/run=${job.runId}/serp.html.gz`, serp.html);
      await deps.store.putText(
        `${deps.rawBucket}/raw/engine=bing/dt=${dt}/run=${job.runId}/meta.json`,
        JSON.stringify({ query: job, fetchedAt: serp.fetchedAt, finalUrl: serp.finalUrl, notice: serp.notice, adCount: serp.ads.length }, null, 2),
        "application/json",
      );

      const observations: ObservationRow[] = serp.ads.map((ad) => ({
        runId: job.runId,
        brand: job.brand,
        brandDomain: job.brandDomain,
        keyword: job.keyword,
        geo: job.geo,
        engine: job.engine,
        fetchedAt: serp.fetchedAt,
        adIndex: ad.adIndex,
        title: ad.title,
        displayUrl: ad.displayUrl,
        displayDomain: ad.displayDomain,
        clickUrl: ad.clickUrl,
        classification: isSelfBid(job, ad) ? "self_bid" : "unknown",
        inspected: false,
      }));

      const thirdParty = serp.ads.filter((ad) => !isSelfBid(job, ad)).slice(0, deps.maxLandings);
      const landings: LandingRow[] = [];
      for (const ad of thirdParty) {
        if (deps.politenessMs > 0 && landings.length > 0) {
          await new Promise((r) => setTimeout(r, deps.politenessMs));
        }
        const inspection = await withSpan(
          "landing.inspect",
          { landing_host: domainOf(ad.clickUrl), ad_index: ad.adIndex },
          async () => {
            const inspection = await deps.inspector.inspect(ad.clickUrl);
            attachAdMeta(deps.signatures, ad.clickUrl, inspection);
            return inspection;
          },
        );
        metrics.landingHops.record(inspection.hops.length, { mode: deps.mode });
        if (inspection.error !== null) metrics.landingErrors.add(1, { mode: deps.mode });
        const classification = classifyLanding(job, ad, inspection);
        landings.push({
          runId: job.runId,
          brand: job.brand,
          keyword: job.keyword,
          geo: job.geo,
          engine: job.engine,
          fetchedAt: serp.fetchedAt,
          adIndex: ad.adIndex,
          title: ad.title,
          displayDomain: ad.displayDomain,
          clickUrl: ad.clickUrl,
          inspection,
          classification,
          networks: [...new Set(inspection.matches.map((m) => m.network))],
        });
      }

      for (const landing of landings) {
        const obs = observations.find((o) => o.adIndex === landing.adIndex);
        if (obs !== undefined) {
          obs.classification = landing.classification;
          obs.inspected = true;
        }
      }

      if (observations.length > 0) {
        await deps.store.putText(
          `${deps.curatedBucket}/curated/observations/dt=${dt}/run=${job.runId}.jsonl`,
          observations.map((o) => JSON.stringify(o)).join("\n") + "\n",
          "application/x-ndjson",
        );
      }
      if (landings.length > 0) {
        await deps.store.putText(
          `${deps.curatedBucket}/curated/landings/dt=${dt}/run=${job.runId}.jsonl`,
          landings.map((l) => JSON.stringify(l)).join("\n") + "\n",
          "application/x-ndjson",
        );
      }

      const violations = landings.filter((l) => l.classification === "affiliate_violation").length;
      metrics.violations.add(violations, { brand: job.brand });
      span.setAttributes({ ads: observations.length, inspected: landings.length, violations });
      deps.log(
        `run=${job.runId} brand=${job.brand} kw="${job.keyword}" ads=${observations.length} inspected=${landings.length} violations=${violations}`,
      );
    },
  );
}
