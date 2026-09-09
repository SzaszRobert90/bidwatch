import { describe, expect, it } from "vitest";
import { classifyLanding, domainOf, isSelfBid, registrableDomain, sameSite } from "../src/domain/domain.js";
import type { AdObservation, LandingInspection, SerpQuery } from "../src/domain/types.js";

const query: SerpQuery = {
  runId: "run_test",
  brand: "nordvpn",
  brandDomain: "nordvpn.com",
  keyword: "nordvpn coupon",
  geo: "us",
  engine: "bing",
  enqueuedAt: "2026-09-09T00:00:00Z",
};

function ad(displayDomain: string): AdObservation {
  return { adIndex: 0, title: "t", description: null, displayUrl: `https://${displayDomain}`, displayDomain, clickUrl: "https://x" };
}

function inspection(overrides: Partial<LandingInspection> = {}): LandingInspection {
  return {
    requestUrl: "https://x",
    requestDomain: "x",
    hops: [],
    finalUrl: "https://x",
    finalDomain: "x",
    httpStatus: 200,
    fetchedAt: "2026-09-09T00:00:00Z",
    matches: [],
    error: null,
    ...overrides,
  };
}

describe("registrableDomain", () => {
  it("strips www and keeps two labels", () => {
    expect(registrableDomain("https://www.nordvpn.com/deals")).toBe("nordvpn.com");
  });
  it("keeps three labels for second-level suffixes", () => {
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
  });
  it("returns empty string for garbage", () => {
    expect(registrableDomain("not a url")).toBe("not a url");
  });
});

describe("sameSite", () => {
  it("matches brand domain with subdomain and path", () => {
    expect(sameSite("www.nordvpn.com/special", "nordvpn.com")).toBe(true);
  });
  it("does not match lookalike substrings", () => {
    expect(sameSite("notnordvpn.com", "nordvpn.com")).toBe(false);
  });
});

describe("classification", () => {
  it("self_bid when display domain is the brand", () => {
    expect(isSelfBid(query, ad("www.nordvpn.com"))).toBe(true);
    expect(classifyLanding(query, ad("www.nordvpn.com"), inspection())).toBe("self_bid");
  });

  it("affiliate_violation when a signature matched", () => {
    const result = classifyLanding(query, ad("coupons-deals.com"), inspection({ matches: [{ network: "shareasale", kind: "param", source: "final_url", evidence: "query param sscid=abc" }] }));
    expect(result).toBe("affiliate_violation");
  });

  it("competitor_conquest for third-party without signature", () => {
    expect(classifyLanding(query, ad("vpn-compare.io"), inspection())).toBe("competitor_conquest");
  });

  it("unknown when inspection failed", () => {
    expect(classifyLanding(query, ad("coupons-deals.com"), inspection({ error: "timeout" }))).toBe("unknown");
  });
});

describe("domainOf", () => {
  it("parses hosts from urls and display strings", () => {
    expect(domainOf("https://www.Coupons-Deals.com/x")).toBe("coupons-deals.com");
    expect(domainOf("coupons-deals.com › nordvpn").startsWith("https://")).toBe(false);
  });
});
