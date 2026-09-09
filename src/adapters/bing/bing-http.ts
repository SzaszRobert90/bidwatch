import { fetch as uFetch, ProxyAgent } from "undici";
import { parseBingAds, detectNotice } from "./parse.js";
import type { SerpProvider } from "../../domain/ports.js";
import type { SerpFetch, SerpQuery } from "../../domain/types.js";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface BingHttpOptions {
  /** Comma-separated proxy URLs; round-robined across requests. Empty = direct. */
  proxies?: string[];
  timeoutMs?: number;
}

/** Plain-HTTP Bing provider: Bing serves full results HTML to a desktop UA. */
export class BingHttpProvider implements SerpProvider {
  private readonly agents: ProxyAgent[];
  private cursor = 0;
  private readonly timeoutMs: number;

  constructor(options: BingHttpOptions = {}) {
    this.agents = (options.proxies ?? [])
      .filter((p) => p.trim().length > 0)
      .map((p) => new ProxyAgent(p.trim()));
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async fetchSerp(query: SerpQuery): Promise<SerpFetch> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query.keyword)}&count=20&mkt=en-${query.geo.toUpperCase()}&setlang=en&cc=${query.geo.toUpperCase()}`;
    const res = await uFetch(url, {
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": `en-${query.geo.toUpperCase()},en;q=0.9`,
      },
      dispatcher: this.nextAgent(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const html = await res.text();
    return {
      query,
      fetchedAt: new Date().toISOString(),
      httpStatus: res.status,
      finalUrl: res.url || url,
      html,
      ads: res.status === 200 ? parseBingAds(html) : [],
      notice: detectNotice(html),
    };
  }

  private nextAgent(): ProxyAgent | undefined {
    if (this.agents.length === 0) return undefined;
    const agent = this.agents[this.cursor % this.agents.length];
    this.cursor += 1;
    return agent;
  }
}
