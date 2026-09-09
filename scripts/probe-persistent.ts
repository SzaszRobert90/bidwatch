/** Probe: persistent profile + real browser channel + headful -> ads? */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const q = process.argv[2] ?? "nike air force 1";
const channel = process.env.BIDWATCH_BROWSER_CHANNEL || "chrome"; // chrome | msedge | (empty -> bundled chromium)
const profileDir = process.env.BIDWATCH_PROFILE_DIR ?? ".profile-bing";

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: channel === "chromium" ? undefined : channel,
  headless: process.env.BIDWATCH_HEADLESS !== "false",
  locale: "en-US",
  viewport: { width: 1280, height: 800 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
// homepage first so the profile accumulates bing cookies like a human session
await page.goto("https://www.bing.com", { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
await page.waitForTimeout(2_000);
await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, {
  waitUntil: "domcontentloaded",
  timeout: 25_000,
});
await page.waitForTimeout(9_000);
const html = await page.content();
writeFileSync("fixtures/probe-persistent.html", html);

const counts: Record<string, number> = {};
for (const sel of ["li.b_ad", "cite.b_adurl", ".b_spl", ".prd_cnt", "#b_pole", ".b_algo"]) {
  const n = await page.locator(sel).count().catch(() => -1);
  if (n > 0) counts[sel] = n;
}
console.log(`channel=${channel} bytes=${html.length} title="${await page.title()}"`);
console.log(JSON.stringify(counts));

// extract aclick URLs if present, like the user's example
const adLinks = await page.$$eval("#b_results a[href*='bing.com/aclick']", (els) =>
  els.slice(0, 5).map((a) => (a as HTMLAnchorElement).href),
);
console.log(`aclick urls: ${adLinks.length}`);
for (const u of adLinks) console.log(`  ${u.slice(0, 90)}...`);
await ctx.close();
