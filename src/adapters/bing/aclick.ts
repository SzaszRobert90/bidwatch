import type { LandingInspector } from "../../domain/ports.js";
import type { LandingInspection } from "../../domain/types.js";

/**
 * Bing ad click-throughs point at bing.com/aclick, which serves a JS
 * interstitial to non-browser clients instead of an HTTP redirect (observed on
 * live data 2026-09-11: status 200, single hop, finalUrl === requestUrl), so a
 * plain-HTTP inspection dead-ends at bing.com. The true destination rides
 * along in the base64-encoded `u` param — decode it and inspect the real
 * landing directly. The original aclick URL is still stored on every row as
 * `clickUrl`, so the evidence chain stays reconstructible.
 */
export function resolveAclickTarget(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)bing\.com$/.test(parsed.hostname) || !parsed.pathname.startsWith("/aclick")) {
    return null;
  }
  const encoded = parsed.searchParams.get("u");
  if (encoded === null || encoded === "") return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const decoded = decodeURIComponent(Buffer.from(base64, "base64").toString("utf8"));
    const target = new URL(decoded);
    if (target.protocol !== "https:" && target.protocol !== "http:") return null;
    return target.toString();
  } catch {
    return null;
  }
}

/** Inspects the decoded aclick destination instead of Bing's JS interstitial. */
export class AclickResolvingInspector implements LandingInspector {
  private readonly inner: LandingInspector;

  constructor(inner: LandingInspector) {
    this.inner = inner;
  }

  async inspect(url: string): Promise<LandingInspection> {
    return this.inner.inspect(resolveAclickTarget(url) ?? url);
  }
}
