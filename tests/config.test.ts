import { describe, expect, it } from "vitest";
import { loadBrands, loadEnv, loadSignatures } from "../src/config.js";

const env = loadEnv({});

describe("config loaders", () => {
  it("loads the seeded brand registry", () => {
    const brands = loadBrands(env);
    expect(brands.length).toBeGreaterThanOrEqual(5);
    const nordvpn = brands.find((b) => b.key === "nordvpn");
    expect(nordvpn?.domain).toBe("nordvpn.com");
    expect(nordvpn?.keywords).toContain("{brand} coupon");
  });

  it("loads the signature database", () => {
    const db = loadSignatures(env);
    const names = db.networks.map((n) => n.network);
    expect(names).toContain("impact");
    expect(names).toContain("shareasale");
    expect(names).toContain("awin");
    const shareasale = db.networks.find((n) => n.network === "shareasale");
    expect(shareasale?.params[0]?.name).toBe("sscid");
  });

  it("env defaults to live mode against localstack-style endpoints when unset", () => {
    expect(env.BIDWATCH_MODE).toBe("live");
    expect(env.BIDWATCH_RAW_BUCKET).toBe("bidwatch-raw");
  });
});
