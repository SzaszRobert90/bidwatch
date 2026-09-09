import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectNotice, parseBingAds } from "../src/adapters/bing/parse.js";

const html = readFileSync("tests/fixtures/bing-sample.html", "utf8");

describe("parseBingAds", () => {
  const ads = parseBingAds(html);

  it("finds only ad blocks, not organic results", () => {
    expect(ads).toHaveLength(3);
  });

  it("extracts title, click url, display url and domain", () => {
    const first = ads[0];
    expect(first?.title).toContain("NordVPN Coupon");
    expect(first?.clickUrl).toContain("bing.com/aclick");
    expect(first?.displayDomain).toBe("coupons-deals.com");
    expect(first?.displayUrl).toBe("https://coupons-deals.com");
  });

  it("extracts description", () => {
    expect(ads[0]?.description).toContain("exclusive discount");
  });

  it("keeps brand-domain ads so the classifier can mark them self_bid", () => {
    expect(ads[1]?.displayDomain).toBe("nordvpn.com");
  });
});

describe("detectNotice", () => {
  it("flags captcha interstitials", () => {
    expect(detectNotice("<div class='px-captcha'>blocked</div>")).toBe("captcha suspected");
  });
  it("returns null for normal pages", () => {
    expect(detectNotice(html)).toBeNull();
  });
});
