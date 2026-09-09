/**
 * Record real fixtures: live Bing SERPs (via the production playwright config)
 * plus landing-page redirect chains for their ads. A visible Chrome window
 * opens while this runs.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { BingPlaywrightProvider } from "../src/adapters/bing/bing-playwright.js";
import { HttpLandingInspector } from "../src/adapters/landing/inspector.js";
import { loadEnv, loadSignatures } from "../src/config.js";
import { isSelfBid } from "../src/domain/domain.js";
import type { RecordedLanding } from "../src/adapters/fixture/fixture.js";
import type { SerpQuery } from "../src/domain/types.js";

const env = loadEnv({});
const signatures = loadSignatures(env);
const provider = new BingPlaywrightProvider({
  profileDir: env.BIDWATCH_PROFILE_DIR,
  channel: env.BIDWATCH_BROWSER_CHANNEL || undefined,
  headless: env.BIDWATCH_HEADLESS !== "true",
});
const inspector = new HttpLandingInspector({ signatures });

const targets: Array<{ brand: string; domain: string; keyword: string }> = [
  { brand: "nordvpn", domain: "nordvpn.com", keyword: "nordvpn coupon" },
  { brand: "notino", domain: "notino.ro", keyword: "notino" },
  { brand: "booking", domain: "booking.com", keyword: "booking promo" },
];

const indexFile = path.join(env.BIDWATCH_FIXTURES_DIR, "landings", "index.json");
const recordings: Record<string, RecordedLanding> = existsSync(indexFile)
  ? JSON.parse(readFileSync(indexFile, "utf8"))
  : {};

let landingCount = 0;
const BODY_PREFIX = 8_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

for (const t of targets) {
  const query: SerpQuery = {
    runId: `run_record_${t.brand}`,
    brand: t.brand,
    brandDomain: t.domain,
    keyword: t.keyword,
    geo: "hu", // honest vantage: home IP market
    engine: "bing",
    enqueuedAt: new Date().toISOString(),
  };
  const serp = await provider.fetchSerp(query);
  const dir = path.join(env.BIDWATCH_FIXTURES_DIR, "serps", t.brand);
  const file = path.join(dir, `${t.keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, serp.html);
  console.log(`${t.brand} "${t.keyword}": http=${serp.httpStatus} ads=${serp.ads.length} -> ${path.basename(file)}`);

  const thirdParty = serp.ads.filter((ad) => !isSelfBid(query, ad));
  for (const ad of thirdParty.slice(0, 4)) {
    if (recordings[ad.clickUrl] !== undefined) continue;
    const inspection = await inspector.inspect(ad.clickUrl);
    let body: string | undefined;
    if (inspection.error === null) {
      try {
        const res = await fetch(inspection.finalUrl, {
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
          headers: { "user-agent": UA, accept: "text/html" },
        });
        body = (await res.text()).slice(0, BODY_PREFIX);
      } catch {
        body = undefined;
      }
    }
    recordings[ad.clickUrl] = {
      status: inspection.httpStatus,
      hops: inspection.hops,
      finalUrl: inspection.finalUrl,
      body,
    };
    landingCount += 1;
    const cls =
      inspection.error !== null ? "error" : inspection.matches.length > 0 ? "AFFILIATE" : "conquest";
    console.log(
      `   landing [${cls}] ${ad.displayDomain} -> ${inspection.finalDomain} hops=${inspection.hops.length}`,
    );
    await new Promise((r) => setTimeout(r, 700));
  }
}

await provider.dispose();

mkdirSync(path.dirname(indexFile), { recursive: true });
writeFileSync(indexFile, JSON.stringify(recordings, null, 1));
console.log(`recorded ${landingCount} landings -> ${indexFile}`);
