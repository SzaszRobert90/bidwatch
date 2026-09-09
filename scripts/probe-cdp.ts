/** Probe: attach to a real Chrome via CDP and check ad visibility. */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const cdpUrl = process.env.BIDWATCH_CDP_URL ?? "http://localhost:9222";
const q = process.argv[2] ?? "nike air force 1";

const browser = await chromium.connectOverCDP(cdpUrl);
const contexts = browser.contexts();
const ctx = contexts[0] ?? (await browser.newContext());
const page = await ctx.newPage();

await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20&mkt=en-US`, {
  waitUntil: "domcontentloaded",
  timeout: 30_000,
});
await page.waitForTimeout(9_000);
const html = await page.content();
writeFileSync("fixtures/probe-cdp.html", html);

const counts: Record<string, number> = {};
for (const sel of ["li.b_ad", "cite.b_adurl", ".b_spl", ".prd_cnt", "#b_pole", ".b_algo"]) {
  const n = await page.locator(sel).count().catch(() => -1);
  if (n > 0) counts[sel] = n;
}
console.log(`cdp=${cdpUrl} q="${q}" bytes=${html.length} title="${await page.title()}"`);
console.log(JSON.stringify(counts));

const adLinks = await page.$$eval("#b_results a", (els) =>
  els
    .map((a) => (a as HTMLAnchorElement).href)
    .filter((h) => h.includes("bing.com/aclick")),
);
console.log(`aclick urls: ${adLinks.length}`);
for (const u of [...new Set(adLinks)].slice(0, 5)) console.log(`  ${u.slice(0, 100)}...`);
await page.close();
await browser.close();
