import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { processJob, type PipelineDeps } from "../src/apps/worker/pipeline.js";
import type { LandingInspection, SerpFetch, SerpQuery } from "../src/domain/types.js";

const job: SerpQuery = {
  runId: "run_abc",
  brand: "nordvpn",
  brandDomain: "nordvpn.com",
  keyword: "nordvpn coupon",
  geo: "us",
  engine: "bing",
  enqueuedAt: "2026-09-09T00:00:00Z",
};

function fakeInspection(clickUrl: string, withSignature: boolean): LandingInspection {
  return {
    requestUrl: clickUrl,
    requestDomain: "coupons-deals.com",
    hops: [{ url: clickUrl, status: 302 }, { url: "https://coupons-deals.com/nordvpn", status: 200 }],
    finalUrl: "https://coupons-deals.com/nordvpn",
    finalDomain: "coupons-deals.com",
    httpStatus: 200,
    fetchedAt: "2026-09-09T00:00:01Z",
    matches: withSignature
      ? [{ network: "shareasale", kind: "param", source: "final_url", evidence: "query param sscid=abc123" }]
      : [],
    error: null,
  };
}

function makeDeps() {
  const puts: Array<{ key: string; body: string; gzip: boolean }> = [];
  const serp: SerpFetch = {
    query: job,
    fetchedAt: "2026-09-09T00:00:01Z",
    httpStatus: 200,
    finalUrl: "https://bing/x",
    html: "<html>serp</html>",
    ads: [
      { adIndex: 0, title: "Coupon site", description: null, displayUrl: "https://coupons-deals.com", displayDomain: "coupons-deals.com", clickUrl: "https://click/1" },
      { adIndex: 1, title: "Official", description: null, displayUrl: "https://www.nordvpn.com", displayDomain: "www.nordvpn.com", clickUrl: "https://click/2" },
      { adIndex: 2, title: "Compare", description: null, displayUrl: "https://vpn-compare.io", displayDomain: "vpn-compare.io", clickUrl: "https://click/3" },
    ],
    notice: null,
  };

  const deps: PipelineDeps = {
    provider: { fetchSerp: async () => serp },
    inspector: { inspect: async (url) => fakeInspection(url, url === "https://click/1") },
    store: {
      putObject: async () => {},
      putText: async (key, body) => {
        puts.push({ key, body, gzip: false });
      },
      putGzip: async (key, text) => {
        puts.push({ key, body: gzipSync(Buffer.from(text)).toString("base64").slice(0, 8), gzip: true });
      },
    },
    rawBucket: "bidwatch-raw",
    curatedBucket: "bidwatch-curated",
    maxLandings: 8,
    politenessMs: 0,
    log: () => {},
  };
  return { deps, puts };
}

describe("processJob", () => {
  it("classifies ads, skips self-bids from inspection, writes raw + curated layers", async () => {
    const { deps, puts } = makeDeps();
    await processJob(deps, job);

    const obsPut = puts.find((p) => p.key.includes("observations"));
    const landingPut = puts.find((p) => p.key.includes("landings"));
    expect(obsPut).toBeDefined();
    expect(landingPut).toBeDefined();

    const observations = obsPut!.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(observations).toHaveLength(3);
    const self = observations.find((o) => o.adIndex === 1);
    expect(self.classification).toBe("self_bid");
    expect(self.inspected).toBe(false);

    const landings = landingPut!.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(landings).toHaveLength(2); // self_bid never inspected
    expect(landings.find((l) => l.adIndex === 0).classification).toBe("affiliate_violation");
    expect(landings.find((l) => l.adIndex === 2).classification).toBe("competitor_conquest");
    expect(landings.find((l) => l.adIndex === 0).networks).toEqual(["shareasale"]);

    expect(puts.find((p) => p.key.includes("bidwatch-raw/raw/engine=bing/dt=2026-09-09/run=run_abc/serp.html.gz"))).toBeDefined();
    expect(puts.find((p) => p.key.includes("meta.json"))).toBeDefined();
  });

  it("throws on non-200 serps so the queue retries", async () => {
    const { deps } = makeDeps();
    const serp = await deps.provider.fetchSerp(job);
    const unavailable = { ...serp, httpStatus: 503 };
    deps.provider.fetchSerp = async () => unavailable;
    await expect(processJob(deps, job)).rejects.toThrow(/503/);
  });
});
