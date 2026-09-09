/** Live test of the playwright SERP provider: do we see ads in the DOM? */
import { BingPlaywrightProvider } from "../src/adapters/bing/bing-playwright.js";
import { loadEnv } from "../src/config.js";

const keywords = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["nordvpn coupon"];
const env = loadEnv({});
const provider = new BingPlaywrightProvider({
  profileDir: env.BIDWATCH_PROFILE_DIR,
  channel: env.BIDWATCH_BROWSER_CHANNEL || undefined,
  headless: env.BIDWATCH_HEADLESS !== "true",
});

for (const keyword of keywords) {
  const serp = await provider.fetchSerp({
    runId: "run_probe",
    brand: keyword.split(" ")[0],
    brandDomain: `${keyword.split(" ")[0]}.com`,
    keyword,
    geo: "hu",
    engine: "bing",
    enqueuedAt: new Date().toISOString(),
  });
  console.log(`"${keyword}": http=${serp.httpStatus} bytes=${serp.html.length} ads=${serp.ads.length} notice=${serp.notice}`);
  for (const ad of serp.ads) {
    const host = (() => {
      try {
        return new URL(ad.clickUrl).host;
      } catch {
        return "?";
      }
    })();
    console.log(`  [${ad.adIndex}] ${ad.displayDomain} | click=${host}/${ad.clickUrl.slice(30, 60)}...`);
  }
}
await provider.dispose();
