/**
 * Bing ad click URLs embed the advertiser's true destination in a base64url
 * `u` query param — including the advertiser's own utm campaign naming, which
 * often names their affiliate network (observed live 2026-09-09:
 * "utm_campaign=Nord ⇆ CS ⇆ Admitad (lmc)"). Decoding it yields attribution
 * evidence with zero HTTP requests, immune to Bing's click guard.
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
