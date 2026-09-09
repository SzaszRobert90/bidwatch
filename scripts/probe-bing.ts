/** Probe: does a cookie-seeded second request get server-rendered ads? */
import { fetch as uFetch } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const headers = (cookie?: string): Record<string, string> => ({
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": cookie === undefined ? "none" : "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  ...(cookie ? { cookie } : {}),
});

const url = `https://www.bing.com/search?q=${encodeURIComponent(process.argv[2] ?? "nordvpn coupon")}&count=20&mkt=en-US`;

const first = await uFetch(url, { headers: headers() });
const cookies = first.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
console.log(`first: http=${first.status} bytes=(see below) cookies=${cookies.length} chars`);

const second = await uFetch(url, { headers: headers(cookies) });
const html = await second.text();
const count = (re: RegExp) => (html.match(re) ?? []).length;
console.log(`second: http=${second.status} bytes=${html.length}`);
console.log(`li.b_ad=${count(/<li[^>]*class="[^"]*b_ad[^"]*"/g)} b_adTop=${count(/b_adTop/g)} b_algo=${count(/b_algo/g)} adlt=${count(/adlt=/g)} cite.b_adurl=${count(/b_adurl/g)}`);
