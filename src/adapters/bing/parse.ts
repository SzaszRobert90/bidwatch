import * as cheerio from "cheerio";
import { domainOf } from "../../domain/domain.js";
import type { AdObservation } from "../../domain/types.js";

/**
 * Parse ads out of a Bing results page. Verified against live DOM (2026-09):
 * ads live in `li.b_ad` blocks (b_adTop/Middle/Bottom), one or more ads per
 * block, titles in `h2 a` (click URLs are bing.com/aclick or bing.com/ck/a),
 * display URL in a `cite` inside `.b_attribution` — sometimes just a brand
 * name with no dot (then displayDomain is unknown).
 */
export function parseBingAds(html: string): AdObservation[] {
  const $ = cheerio.load(html);
  const ads: AdObservation[] = [];
  const seen = new Set<string>();

  $("li.b_ad, li.sb_ad").each((_, block) => {
    $(block)
      .find("h2 a")
      .each((_, anchor) => {
        const el = $(anchor);
        const title = el.text().trim();
        const clickUrl = el.attr("href") ?? "";
        if (title.length === 0 || clickUrl.length === 0) return;
        if (seen.has(clickUrl)) return;

        const container = el.closest("li");
        const attribution = container.find(".b_attribution").first();
        const cite =
          container.find("cite.b_adurl").first().text().trim() ||
          (attribution.length > 0 ? attribution.find("cite").first().text().trim() : "") ||
          (attribution.length > 0 ? attribution.clone().children().remove().end().text().trim() : "");
        const { displayUrl, displayDomain } = parseDisplay(cite);
        const description = container.find("p").first().text().trim() || null;

        ads.push({
          adIndex: ads.length,
          title,
          description: description && description.length > 0 ? description : null,
          displayUrl,
          displayDomain,
          clickUrl,
        });
        seen.add(clickUrl);
      });
  });

  return ads;
}

/** Cite lines look like "example.com › path" (with dots) or a bare brand name (without). */
function parseDisplay(cite: string): { displayUrl: string; displayDomain: string } {
  if (cite.length === 0) return { displayUrl: "", displayDomain: "" };
  if (!cite.includes(".")) return { displayUrl: cite, displayDomain: "" };
  const first = cite.split("›")[0] ?? cite;
  const url = `https://${first.trim().replace(/^https?:\/\//, "")}`;
  return { displayUrl: url, displayDomain: domainOf(url) };
}

/** Detect interstitials that mean we are being challenged rather than served. */
export function detectNotice(html: string): string | null {
  if (/g\.recaptcha|px-captcha|challenge-platform/i.test(html)) return "captcha suspected";
  return null;
}
