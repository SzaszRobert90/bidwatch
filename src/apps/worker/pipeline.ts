import type { LandingInspector, ResultStore, SerpProvider } from "../../domain/ports.js";
import type { LandingRow, ObservationRow, SerpQuery } from "../../domain/types.js";
import { classifyLanding, isSelfBid } from "../../domain/domain.js";

export interface PipelineDeps {
  provider: SerpProvider;
  inspector: LandingInspector;
  store: ResultStore;
  rawBucket: string;
  curatedBucket: string;
  maxLandings: number;
  politenessMs: number;
  log: (msg: string, ...rest: unknown[]) => void;
}

/**
 * One queue job = one SERP fetch + landing inspections.
 * Raw layer keeps the full SERP HTML (gzipped) for reparse; curated layers
 * hold one JSONL row per ad observation and per landing inspection.
 */
export async function processJob(deps: PipelineDeps, job: SerpQuery): Promise<void> {
  const serp = await deps.provider.fetchSerp(job);
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
    const inspection = await deps.inspector.inspect(ad.clickUrl);
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
  deps.log(
    `run=${job.runId} brand=${job.brand} kw="${job.keyword}" ads=${observations.length} inspected=${landings.length} violations=${violations}`,
  );
}
