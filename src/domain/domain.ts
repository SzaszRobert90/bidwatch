import type {
  AdObservation,
  LandingClass,
  LandingInspection,
  SerpQuery,
} from "./types.js";

/**
 * Loose registrable-domain comparison: last two labels, with a small second-level
 * suffix list (co.uk etc.). Good enough to spot self-bidding; affiliate matching
 * does not depend on it.
 */
const SECOND_LEVEL = new Set([
  "co.uk", "org.uk", "me.uk", "com.au", "co.nz", "co.jp", "com.br",
  "co.za", "com.mx", "co.in", "com.sg", "com.tr", "com.ar", "co.il",
]);

export function domainOf(hostOrUrl: string): string {
  let host = hostOrUrl.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  } else {
    host = host.split(/[/?#]/)[0] ?? "";
  }
  return host.replace(/^www\./, "").replace(/:\d+$/, "");
}

export function registrableDomain(hostOrUrl: string): string {
  const host = domainOf(hostOrUrl);
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (SECOND_LEVEL.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

export function sameSite(a: string, b: string): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return da.length > 0 && da === db;
}

export function classifyLanding(
  query: SerpQuery,
  ad: AdObservation,
  inspection: LandingInspection,
): LandingClass {
  if (sameSite(ad.displayDomain, query.brandDomain)) return "self_bid";
  // ad_meta matches come from Bing's own click-URL metadata and hold even when
  // the landing fetch was guarded — that combination is a verified catch.
  if (inspection.matches.length > 0) return "affiliate_violation";
  if (inspection.error !== null) return "unknown";
  return "competitor_conquest";
}

/** Cheap classification before any landing fetch: is this ad even the brand itself? */
export function isSelfBid(query: SerpQuery, ad: AdObservation): boolean {
  return sameSite(ad.displayDomain, query.brandDomain);
}
