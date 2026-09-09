import { fetch as uFetch, ProxyAgent, type Dispatcher } from "undici";
import type { LandingInspector } from "../../domain/ports.js";
import type { LandingInspection } from "../../domain/types.js";
import { domainOf } from "../../domain/domain.js";
import { matchSignatures } from "./match.js";
import type { SignatureDb } from "../../domain/types.js";

export type LandingTransport = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal; dispatcher?: Dispatcher },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  url: string;
  text(): Promise<string>;
}>;

export interface InspectorOptions {
  signatures: SignatureDb;
  transport?: LandingTransport;
  maxHops?: number;
  timeoutMs?: number;
  /** Cap on response body read, in characters. */
  maxBodyChars?: number;
  proxies?: string[];
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Follows an ad's click URL through its redirect chain (plus one HTML meta
 * refresh if present), records every hop as evidence, and runs the signature
 * matcher over the chain, the final URL, and the landing body.
 */
export class HttpLandingInspector implements LandingInspector {
  private readonly db: SignatureDb;
  private readonly transport: LandingTransport;
  private readonly maxHops: number;
  private readonly timeoutMs: number;
  private readonly maxBodyChars: number;

  constructor(options: InspectorOptions) {
    this.db = options.signatures;
    this.transport = options.transport ?? defaultTransport(options.proxies ?? []);
    this.maxHops = options.maxHops ?? 8;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxBodyChars = options.maxBodyChars ?? 300_000;
  }

  async inspect(url: string): Promise<LandingInspection> {
    const hops: LandingInspection["hops"] = [];
    const urls: string[] = [url];
    let current = url;
    let finalBody: string | null = null;
    let status = 0;
    let error: string | null = null;

    try {
      for (let hop = 0; hop <= this.maxHops; hop++) {
        const res = await this.transport(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = res.status;
        hops.push({ url: current, status });

        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          current = new URL(location, current).toString();
          urls.push(current);
          continue;
        }

        let body = await res.text();
        if (body.length > this.maxBodyChars) body = body.slice(0, this.maxBodyChars);
        finalBody = body;

        const metaRefresh = /http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'>\s]+)/i.exec(body);
        const refreshTarget = metaRefresh?.[1];
        if (refreshTarget !== undefined && hop < this.maxHops) {
          current = new URL(refreshTarget, current).toString();
          urls.push(current);
          continue;
        }
        break;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const finalUrl = urls[urls.length - 1] ?? url;
    const matches = error === null ? matchSignatures(this.db, { urls, body: finalBody }) : [];

    return {
      requestUrl: url,
      requestDomain: domainOf(url),
      hops,
      finalUrl,
      finalDomain: domainOf(finalUrl),
      httpStatus: status,
      fetchedAt: new Date().toISOString(),
      matches,
      error,
    };
  }
}

function defaultTransport(proxies: string[]): LandingTransport {
  const agents = proxies.filter((p) => p.trim()).map((p) => new ProxyAgent(p.trim()));
  let cursor = 0;
  return (url, init) => {
    const dispatcher = agents.length > 0 ? agents[cursor++ % agents.length] : undefined;
    return uFetch(url, {
      redirect: init.redirect,
      signal: init.signal,
      dispatcher,
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });
  };
}
