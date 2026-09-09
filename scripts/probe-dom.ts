/** Inspect which ad-ish containers exist in the live DOM for a query. */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const q = process.argv[2] ?? "nike air force 1";
const out = process.argv[3] ?? "fixtures/probe-dom.html";

const b = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await b.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20&mkt=en-US`, {
  waitUntil: "domcontentloaded",
  timeout: 25_000,
});
await page.waitForTimeout(9_000);
const html = await page.content();
mkdirSync("fixtures", { recursive: true });
writeFileSync(out, html);

const counts: Record<string, number> = {};
const selectors = [
  "li.b_ad", ".b_adTop", ".ads", "cite.b_adurl", ".b_adurl", "div.b_spl", "ol.b_spl",
  ".prd_cnt", ".b_prom", ".b_algoSl", ".sb_adds", ".b_ads", ".pa_carousel",
  ".b_smAd", "#b_pole", ".b_PolePAContainer", "[data-bm]", ".ad_eslt",
];
for (const sel of selectors) {
  const n = await page.locator(sel).count().catch(() => -1);
  if (n > 0) counts[sel] = n;
}
console.log(`bytes=${html.length} title="${await page.title()}"`);
console.log(JSON.stringify(counts, null, 1));
// Also: which top-level result types did we get?
const liClasses = await page.$$eval("#b_results > li", (els) =>
  els.slice(0, 20).map((e) => e.className.split(" ").slice(0, 2).join(".")),
);
console.log("result classes:", JSON.stringify(liClasses));
await b.close();
