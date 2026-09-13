import { describe, expect, it } from "vitest";
import { matchSignatures } from "../src/adapters/landing/match.js";
import type { SignatureDb } from "../src/domain/types.js";

const db: SignatureDb = {
  networks: [
    {
      network: "shareasale",
      params: [{ name: "sscid", valuePattern: "^[A-Za-z0-9_-]+$" }],
      valuePatterns: [],
      domains: ["shareasale.com"],
      disclosure: ["we (?:may )?(?:earn|receive) (?:a )?commission"],
    },
    { network: "impact", params: [{ name: "irgwc" }], valuePatterns: [], domains: ["pxf.io"], disclosure: [] },
    {
      network: "amazon-associates",
      params: [{ name: "tag", valuePattern: "^[a-z0-9-]{3,20}$" }],
      valuePatterns: [],
      domains: [],
      disclosure: [],
    },
    {
      network: "admitad",
      params: [],
      valuePatterns: ["admitad"],
      domains: ["admitad.com"],
      disclosure: [],
    },
  ],
};

describe("matchSignatures", () => {
  it("matches a tracking param on the final URL with value pattern", () => {
    const matches = matchSignatures(db, { urls: ["https://shop.example/x?sscid=abc123"], body: null });
    expect(matches).toContainEqual(
      expect.objectContaining({ network: "shareasale", kind: "param", source: "final_url" }),
    );
  });

  it("rejects param values failing the pattern", () => {
    const matches = matchSignatures(db, { urls: ["https://shop.example/x?sscid=%20%20"], body: null });
    expect(matches).toHaveLength(0);
  });

  it("matches tracker domains anywhere on the chain", () => {
    const matches = matchSignatures(db, {
      urls: ["https://pxf.io/c/123", "https://shop.example/x"],
      body: null,
    });
    expect(matches.some((m) => m.network === "impact" && m.source === "chain")).toBe(true);
  });

  it("matches disclosure regex in the body", () => {
    const matches = matchSignatures(db, { urls: ["https://shop.example/x"], body: "We may earn a commission when you buy." });
    expect(matches.some((m) => m.kind === "disclosure")).toBe(true);
  });

  it("matches amazon tag param", () => {
    const matches = matchSignatures(db, { urls: ["https://www.amazon.com/dp/B123?tag=deals4you-20"], body: null });
    expect(matches.some((m) => m.network === "amazon-associates")).toBe(true);
  });

  it("matches network names hidden in param VALUES (utm_campaign=… Admitad …)", () => {
    const url = `https://couponsmith.com/promo/nordvpn?utm_campaign=${encodeURIComponent("Nord ⇆ CS ⇆ Admitad (lmc)")}&utm_source=bing`;
    const matches = matchSignatures(db, { urls: [url], body: null });
    const hit = matches.find((m) => m.network === "admitad");
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("value");
    expect(hit?.source).toBe("final_url");
  });

  it("does not match a param that only looks similar", () => {
    const matches = matchSignatures(db, { urls: ["https://shop.example/x?sscid2=abc123"], body: null });
    expect(matches).toHaveLength(0);
  });

  it("dedupes repeated evidence", () => {
    const matches = matchSignatures(db, {
      urls: ["https://shareasale.com/r.cfm?sscid=abc", "https://shareasale.com/r.cfm?sscid=abc"],
      body: null,
    });
    const domainHits = matches.filter((m) => m.kind === "domain");
    expect(domainHits).toHaveLength(1);
  });
});
