import { describe, expect, it } from "vitest";
import { AclickResolvingInspector } from "../src/adapters/bing/aclick.js";
import { resolveAclickTarget } from "../src/domain/aclick.js";
import type { LandingInspection } from "../src/domain/types.js";

// Real capture: curated landings dt=2026-09-09, nordvpn / bigcouponcodes.com.
const REAL_ACLICK =
  "https://www.bing.com/aclick?ld=e80ODKM30r70RfsI9i8_UKWzVUCUzkmJOfSAgvGfMzrLGxKKhjC3p70x8Awk_gGEpfWFGDA4Acxpl0B7OsqkIOIJ2ba0NAda3ZK3FauLWnKqJzVVtA5JdCBn9YMj-8NSkJ84Cfz-DKrr4L3Lpw9Dg22cTiWsVFrSpCEtZx_oJIcQWy4hJdu-SvFRsu6x9nQgCAWTKZcnY84J2wgjdG3ATyv9kgCf4" +
  "&u=aHR0cHMlM2ElMmYlMmZiaWdjb3Vwb25jb2Rlcy5jb20lMmZzdG9yZSUyZm5vcmR2cG4tcHJvbW8tY29kZSUyZiUzZmNhbXBhaWduaWQlM2Q0ODY5MDAxMjclMjZhZGdyb3VwaWQlM2QxMjI0ODU3NTQ1NzYyMDE2JTI2bXNjbGtpZCUzZGVjODRiYjI2MmE3NDEzNTA2MGZiZDE4N2FmOWQ5ODMx" +
  "&rlid=ec84bb262a74135060fbd187af9d9831&ntb=1";
const REAL_TARGET =
  "https://bigcouponcodes.com/store/nordvpn-promo-code/?campaignid=486900127&adgroupid=1224857545762016&msclkid=ec84bb262a74135060fbd187af9d9831";

describe("resolveAclickTarget", () => {
  it("decodes the u param of a real aclick capture to the true landing", () => {
    expect(resolveAclickTarget(REAL_ACLICK)).toBe(REAL_TARGET);
  });

  it("decodes the real couponsmith destination with campaign naming intact (2026-09-09)", () => {
    const u =
      "aHR0cHMlM2ElMmYlMmZjb3Vwb25zbWl0aC5jb20lMmZ1cy1lbiUyZnByb21vLWNvZGVzJTJmbm9yZHZwbiUzZnVybCUzZGh0dHBzJTI1M0ElMjUyRiUyNTJGY291cG9uc21pdGguY29tJTI1MkZ1cy1lbiUyNTJGcHJvbW8tY29kZXMlMjUyRm5vcmR2cG4lMjZkZXZpY2UlM2RjJTI2bmV0d29yayUzZG8lMjZjYW1wYWlnbiUzZDUyNDMxNzg3OCUyNmt3ZCUzZG5vcmR2cG4lMjUyMGNvdXBvbiUyNm1lZGl1bSUzZGNwYyUyNmFkZ3JvdXBpZCUzZDEzMTM5MTkzMTM2NzEyMDElMjZsb2NfaW50ZXJlc3QlM2QlMjZsb2NfcGh5c2ljYWwlM2QyMjQlMjZ0YXJnZXRpZCUzZGt3ZC04MjEyMTY4ODIxMzUwMyUyNm1hdGNodHlwZSUzZGUlMjZtc2Nsa2lkJTNkYWJlMzRiNzkyNTIzMTg1ZTBhOWEyMWQ4YTBjYTRmYTQlMjZ1dG1fc291cmNlJTNkYmluZyUyNnV0bV9tZWRpdW0lM2RjcGMlMjZ1dG1fY2FtcGFpZ24lM0ROb3JkJTI1MjAlZTIlODclODYlMjUyMENTJTI1MjAlZTIlODclODYlMjUyMEFkbWl0YWQlMjUyMChsbWMpJTI2dXRtX3Rlcm0lM2Rub3JkdnBuJTI1MjBjb3Vwb24lMjZ1dG1fY29udGVudCUzZE5vcmQlMjUyMCVlMiU5ZSVhNSUyNTIwQ1M";
    const target = resolveAclickTarget(`https://www.bing.com/aclick?ld=e8LIVE&u=${u}`);
    expect(target).toContain("https://couponsmith.com/us-en/promo-codes/nordvpn");
    expect(target!.toLowerCase()).toContain("admitad");
  });

  it("tolerates url-safe base64 and missing padding", () => {
    const target = Buffer.from("https://example.com/page?a=b", "utf8").toString("base64url").replace(/=+$/, "");
    expect(resolveAclickTarget(`https://www.bing.com/aclick?u=${target}`)).toBe("https://example.com/page?a=b");
  });

  it("ignores non-aclick urls", () => {
    expect(resolveAclickTarget("https://example.com/aclick?u=aHR0cHM6Ly9leGFtcGxlLmNvbQ")).toBeNull();
    expect(resolveAclickTarget("https://www.bing.com/search?q=nordvpn+coupon")).toBeNull();
    expect(resolveAclickTarget("not a url")).toBeNull();
  });

  it("returns null when u is missing or undecodable", () => {
    expect(resolveAclickTarget("https://www.bing.com/aclick?ld=abc")).toBeNull();
    expect(resolveAclickTarget("https://www.bing.com/aclick?u=!!!not-base64!!!")).toBeNull();
  });
});

function stubInspection(url: string): LandingInspection {
  return {
    requestUrl: url,
    requestDomain: url,
    hops: [],
    finalUrl: url,
    finalDomain: url,
    httpStatus: 200,
    fetchedAt: "2026-09-11T00:00:00.000Z",
    matches: [],
    error: null,
    adMetaUrl: null,
  };
}

describe("AclickResolvingInspector", () => {
  it("inspects the decoded target instead of the aclick interstitial", async () => {
    const seen: string[] = [];
    const inner = {
      inspect: async (url: string) => {
        seen.push(url);
        return stubInspection(url);
      },
    };
    const inspection = await new AclickResolvingInspector(inner).inspect(REAL_ACLICK);
    expect(seen).toEqual([REAL_TARGET]);
    expect(inspection.requestUrl).toBe(REAL_TARGET);
  });

  it("passes through urls it cannot resolve", async () => {
    const plain = "https://advertiser.com/landing";
    const seen: string[] = [];
    const inner = {
      inspect: async (url: string) => {
        seen.push(url);
        return stubInspection(url);
      },
    };
    await new AclickResolvingInspector(inner).inspect(plain);
    expect(seen).toEqual([plain]);
  });
});
