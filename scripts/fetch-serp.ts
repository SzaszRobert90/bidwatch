/** Live fixture helper: fetch one Bing SERP, save it, and report what the parser sees. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BingHttpProvider } from "../src/adapters/bing/bing-http.js";

const keyword = process.argv[2] ?? "nordvpn coupon";
const brand = process.argv[3] ?? keyword.split(" ")[0];
const outFile = process.argv[4] ?? path.join("fixtures", "serps", brand, `${keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`);

const provider = new BingHttpProvider({ timeoutMs: 20_000 });
const serp = await provider.fetchSerp({
  runId: "run_fixture",
  brand,
  brandDomain: `${brand}.com`,
  keyword,
  geo: "us",
  engine: "bing",
  enqueuedAt: new Date().toISOString(),
});

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, serp.html);
console.log(`http=${serp.httpStatus} bytes=${serp.html.length} ads=${serp.ads.length} notice=${serp.notice} -> ${outFile}`);
for (const ad of serp.ads.slice(0, 10)) {
  console.log(`  [${ad.adIndex}] ${ad.displayDomain} :: ${ad.title.slice(0, 70)}`);
}
