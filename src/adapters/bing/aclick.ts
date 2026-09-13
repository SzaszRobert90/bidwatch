import type { LandingInspector } from "../../domain/ports.js";
import type { LandingInspection } from "../../domain/types.js";
import { resolveAclickTarget } from "../../domain/aclick.js";

/**
 * Bing ad click-throughs point at bing.com/aclick, which serves a JS
 * interstitial to non-browser clients instead of an HTTP redirect (observed on
 * live data 2026-09-11: status 200, single hop, finalUrl === requestUrl), so a
 * plain-HTTP inspection dead-ends at bing.com. The true destination rides
 * along in the base64-encoded `u` param — decode it and inspect the real
 * landing directly. The original aclick URL is still stored on every row as
 * `clickUrl`, so the evidence chain stays reconstructible.
 */
export class AclickResolvingInspector implements LandingInspector {
  private readonly inner: LandingInspector;

  constructor(inner: LandingInspector) {
    this.inner = inner;
  }

  async inspect(url: string): Promise<LandingInspection> {
    return this.inner.inspect(resolveAclickTarget(url) ?? url);
  }
}
