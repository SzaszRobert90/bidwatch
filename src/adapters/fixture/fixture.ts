import { readFileSync } from "node:fs";
import path from "node:path";
import type { LandingInspector, SerpProvider } from "../../domain/ports.js";
import type { LandingInspection, SerpFetch, SerpQuery } from "../../domain/types.js";
import { domainOf } from "../../domain/domain.js";
import { matchSignatures } from "../landing/match.js";
import { parseBingAds } from "../bing/parse.js";
import type { SignatureDb } from "../../domain/types.js";

/** Replays committed fixture HTML — dev and CI never touch Bing. */
export class FixtureSerpProvider implements SerpProvider {
  constructor(private readonly fixturesDir: string) {}

  async fetchSerp(query: SerpQuery): Promise<SerpFetch> {
    const file = path.join(this.fixturesDir, "serps", query.brand, `${slug(query.keyword)}.html`);
    const html = readFileSync(file, "utf8");
    return {
      query,
      fetchedAt: new Date().toISOString(),
      httpStatus: 200,
      finalUrl: `fixture://${query.brand}/${slug(query.keyword)}`,
      html,
      ads: parseBingAds(html),
      notice: null,
    };
  }
}

export interface RecordedLanding {
  status: number;
  hops: Array<{ url: string; status: number }>;
  finalUrl: string;
  body?: string;
}

/** Replays recorded redirect chains from fixtures/landings/index.json. */
export class FixtureLandingInspector implements LandingInspector {
  private readonly recordings: Record<string, RecordedLanding>;

  constructor(
    private readonly signatures: SignatureDb,
    fixturesDir: string,
  ) {
    this.recordings = JSON.parse(
      readFileSync(path.join(fixturesDir, "landings", "index.json"), "utf8"),
    ) as Record<string, RecordedLanding>;
  }

  async inspect(url: string): Promise<LandingInspection> {
    const recorded = this.recordings[url];
    if (recorded === undefined) {
      return {
        requestUrl: url,
        requestDomain: domainOf(url),
        hops: [],
        finalUrl: url,
        finalDomain: domainOf(url),
        httpStatus: 0,
        fetchedAt: new Date().toISOString(),
        matches: [],
        error: "no landing fixture recorded",
      };
    }
    const chainUrls = recorded.hops.map((h) => h.url);
    if (chainUrls[chainUrls.length - 1] !== recorded.finalUrl) chainUrls.push(recorded.finalUrl);
    return {
      requestUrl: url,
      requestDomain: domainOf(url),
      hops: recorded.hops,
      finalUrl: recorded.finalUrl,
      finalDomain: domainOf(recorded.finalUrl),
      httpStatus: recorded.status,
      fetchedAt: new Date().toISOString(),
      matches: matchSignatures(this.signatures, { urls: chainUrls, body: recorded.body ?? null }),
      error: null,
    };
  }
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
