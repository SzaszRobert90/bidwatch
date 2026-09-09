import { describe, expect, it } from "vitest";
import { FixtureLandingInspector, FixtureSerpProvider, slug } from "../src/adapters/fixture/fixture.js";
import { loadEnv, loadSignatures } from "../src/config.js";

const env = loadEnv({ BIDWATCH_FIXTURES_DIR: "tests/fixtures" });
const signatures = loadSignatures(env);

describe("FixtureSerpProvider", () => {
  it("replays committed fixture html through the real parser", async () => {
    const provider = new FixtureSerpProvider("tests/fixtures");
    const serp = await provider.fetchSerp({
      runId: "run_test",
      brand: "nordvpn",
      brandDomain: "nordvpn.com",
      keyword: "nordvpn coupon",
      geo: "us",
      engine: "bing",
      enqueuedAt: "2026-09-09T00:00:00Z",
    });
    expect(serp.ads).toHaveLength(2);
    expect(serp.ads[0]?.displayDomain).toBe("coupons-deals.com");
  });
});

describe("FixtureLandingInspector", () => {
  it("replays recorded chains and runs the signature matcher", async () => {
    const inspector = new FixtureLandingInspector(signatures, "tests/fixtures");
    const inspection = await inspector.inspect(
      "https://www.bing.com/aclick?ld=e8A1ZyTEST&u=aHR0cDovL2NvdXBvbnMtZGVhbHMuY29tL25vcmR2cG4%2Fc3NjaWQ9YWJjMTIz&nta=0",
    );
    expect(inspection.error).toBeNull();
    expect(inspection.matches.some((m) => m.network === "shareasale")).toBe(true);
    expect(inspection.matches.some((m) => m.kind === "disclosure")).toBe(true);
  });

  it("marks unknown urls as errors instead of throwing", async () => {
    const inspector = new FixtureLandingInspector(signatures, "tests/fixtures");
    const inspection = await inspector.inspect("https://not-recorded.example/x");
    expect(inspection.error).toBe("no landing fixture recorded");
  });
});

describe("slug", () => {
  it("slugs keywords into file names", () => {
    expect(slug("NordVPN coupon!")).toBe("nordvpn-coupon");
  });
});
