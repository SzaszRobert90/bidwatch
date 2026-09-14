import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { runTransform } from "../src/duckdb/transform.js";

/**
 * Unit test for the bronze->silver->gold SQL, against a synthetic lake on the
 * local filesystem (no S3, no httpfs). Fixture shapes mirror the worker's
 * output exactly: pretty-printed meta.json, NDJSON extracts under
 * curated/observations|landings.
 */

const ROOT = mkdtempSync(path.join(tmpdir(), "bw-transform-"));
const rawLake = path.join(ROOT, "raw").replaceAll("\\", "/");
const curatedLake = path.join(ROOT, "curated").replaceAll("\\", "/");

const NIKE = { brand: "nike", brandDomain: "nike.com", keyword: "nike air force 1", geo: "hu", engine: "bing" };
const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"];

function meta(runId: string, dt: string, adCount: number): string {
  return JSON.stringify(
    { query: { runId, ...NIKE, enqueuedAt: `${dt}T05:00:00.000Z` }, fetchedAt: `${dt}T06:00:11.000Z`, finalUrl: "https://www.bing.com/search?q=nike", notice: null, adCount },
    null,
    2,
  );
}
function obs(runId: string, dt: string, adIndex: number, displayDomain: string, classification: string, inspected = true): string {
  return JSON.stringify({ runId, ...NIKE, fetchedAt: `${dt}T06:00:11.000Z`, adIndex, title: `Ad ${adIndex}`, displayUrl: `${displayDomain}/x`, displayDomain, clickUrl: `https://www.bing.com/aclick?u=${adIndex}`, classification, inspected });
}
function landing(runId: string, dt: string, adIndex: number, displayDomain: string, classification: string, over: Partial<Record<string, unknown>> = {}): string {
  const inspection = {
    requestUrl: `https://r.test/${adIndex}`,
    requestDomain: "r.test",
    hops: [{ url: `https://r.test/${adIndex}`, status: 200 }],
    finalUrl: `https://${displayDomain}/final`,
    finalDomain: displayDomain,
    httpStatus: 200,
    fetchedAt: `${dt}T06:00:20.000Z`,
    matches: [] as unknown[],
    error: null,
    adMetaUrl: `https://${displayDomain}/dest`,
    ...over,
  };
  return JSON.stringify({ runId, brand: NIKE.brand, keyword: NIKE.keyword, geo: NIKE.geo, engine: NIKE.engine, fetchedAt: `${dt}T06:00:11.000Z`, adIndex, title: `Ad ${adIndex}`, displayDomain, clickUrl: `https://www.bing.com/aclick?u=${adIndex}`, inspection, classification, networks: [...new Set((inspection.matches as Array<{ network: string }>).map((m) => m.network))] });
}

function writeRun(dt: string, runId: string, adCount: number, obsRows: string[], landingRows: string[]): void {
  const runDir = path.join(ROOT, "raw", "raw", `engine=bing`, `dt=${dt}`, `run=${runId}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "meta.json"), meta(runId, dt, adCount));
  if (obsRows.length > 0) {
    const obsDir = path.join(ROOT, "curated", "curated", "observations", `dt=${dt}`);
    mkdirSync(obsDir, { recursive: true });
    writeFileSync(path.join(obsDir, `${runId}.jsonl`), obsRows.join("\n") + "\n");
  }
  if (landingRows.length > 0) {
    const landDir = path.join(ROOT, "curated", "curated", "landings", `dt=${dt}`);
    mkdirSync(landDir, { recursive: true });
    writeFileSync(path.join(landDir, `${runId}.jsonl`), landingRows.join("\n") + "\n");
  }
}

beforeAll(() => {
  // nike days 1-7: one steady conquest ad from regular.com
  DAYS.slice(0, 7).forEach((dt) => {
    const runId = `run_${dt.replaceAll("-", "")}`;
    const matches = [{ network: "sofistrate", kind: "domain", source: "ad_meta", evidence: "domain regular.com/offer" }];
    writeRun(dt, runId, 1, [obs(runId, dt, 0, "regular.com", "competitor_conquest")], [landing(runId, dt, 0, "regular.com", "competitor_conquest", { matches })]);
  });
  // nike day 8: the run happened but found ZERO ads -> absence must be a row
  writeRun("2026-09-08", "run_20260908", 0, [], []);
  // nike day 9: back to volume, plus a first-seen advertiser -> new entrant
  writeRun("2026-09-09", "run_20260909", 2, [obs("run_20260909", "2026-09-09", 0, "regular.com", "competitor_conquest"), obs("run_20260909", "2026-09-09", 1, "newbie-shop.com", "unknown", false)], [landing("run_20260909", "2026-09-09", 0, "regular.com", "competitor_conquest", { matches: [{ network: "sofistrate", kind: "domain", source: "ad_meta", evidence: "domain regular.com/offer" }] })]);
  // adidas: only day 9, with a broken landing -> dqi findings
  const A = { brand: "adidas", brandDomain: "adidas.com", keyword: "adidas outlet", geo: "us", engine: "bing" };
  const aRun = "run_20260909_ad";
  const aMeta = JSON.stringify({ query: { runId: aRun, ...A, enqueuedAt: "2026-09-09T05:00:00.000Z" }, fetchedAt: "2026-09-09T06:00:11.000Z", finalUrl: "https://www.bing.com/search?q=adidas", notice: null, adCount: 1 }, null, 2);
  mkdirSync(path.join(ROOT, "raw", "raw", "engine=bing", "dt=2026-09-09", `run=${aRun}`), { recursive: true });
  writeFileSync(path.join(ROOT, "raw", "raw", "engine=bing", "dt=2026-09-09", `run=${aRun}`, "meta.json"), aMeta);
  const aObsDir = path.join(ROOT, "curated", "curated", "observations", "dt=2026-09-09");
  mkdirSync(aObsDir, { recursive: true });
  writeFileSync(path.join(aObsDir, `${aRun}.jsonl`), JSON.stringify({ runId: aRun, ...A, fetchedAt: "2026-09-09T06:00:11.000Z", adIndex: 0, title: "Ad 0", displayUrl: "reseller.io/x", displayDomain: "reseller.io", clickUrl: "https://www.bing.com/aclick?u=a", classification: "unknown", inspected: true }) + "\n");
  const aLandDir = path.join(ROOT, "curated", "curated", "landings", "dt=2026-09-09");
  mkdirSync(aLandDir, { recursive: true });
  writeFileSync(path.join(aLandDir, `${aRun}.jsonl`), JSON.stringify({ runId: aRun, brand: "adidas", keyword: "adidas outlet", geo: "us", engine: "bing", fetchedAt: "2026-09-09T06:00:11.000Z", adIndex: 0, title: "Ad 0", displayDomain: "reseller.io", clickUrl: "https://www.bing.com/aclick?u=a", inspection: { requestUrl: "https://r.test/a", requestDomain: "r.test", hops: [{ url: "https://r.test/a", status: 403 }], finalUrl: "https://r.test/a", finalDomain: "r.test", httpStatus: 403, fetchedAt: "2026-09-09T06:00:20.000Z", matches: [], error: "blocked by bot guard", adMetaUrl: "https://reseller.io/dest" }, classification: "unknown", networks: [] }) + "\n");
  // local COPY needs the export parents to exist (S3 has no directories)
  for (const table of ["daily_brand_keyword", "anomalies", "evidence"]) {
    mkdirSync(path.join(ROOT, "curated", "gold", table), { recursive: true });
  }
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

let conn: DuckDBConnection;

beforeAll(async () => {
  const instance = await DuckDBInstance.create(":memory:");
  conn = await instance.connect();
  await runTransform(conn, { rawLake, curatedLake });
});

const cell = (row: Record<string, unknown> | undefined, key: string): string => String(row?.[key]);

async function rows(sql: string): Promise<Array<Record<string, unknown>>> {
  const result = await conn.runAndReadAll(sql);
  return result.getRowObjectsJson();
}

describe("transform (bronze -> silver -> gold)", () => {
  it("silver_runs counts every run, including the zero-ad day", async () => {
    const all = await rows("SELECT count(*) AS n FROM silver_runs");
    expect(cell(all[0], "n")).toBe("10"); // 9 nike + 1 adidas
    const zero = await rows("SELECT * FROM silver_runs WHERE dt = DATE '2026-09-08' AND brand = 'nike'");
    expect(zero.length).toBe(1);
    expect(cell(zero[0], "ads_expected")).toBe("0");
  });

  it("silver_daily anchors to the expected grid so absence is a row", async () => {
    const all = await rows("SELECT count(*) AS n FROM silver_daily");
    expect(cell(all[0], "n")).toBe("18"); // 9 days x 2 brand/keyword pairs
    const zero = await rows("SELECT * FROM silver_daily WHERE dt = DATE '2026-09-08' AND brand = 'nike'");
    expect(cell(zero[0], "runs_seen")).toBe("1");
    expect(cell(zero[0], "ads_seen")).toBe("0");
    expect(cell(zero[0], "capture_ratio")).toBe("null"); // nothing expected, nothing captured
  });

  it("flags the zero-ad day as a disappearance and keeps cold-start days quiet", async () => {
    const flags = await rows("SELECT * FROM gold_anomalies WHERE kind IN ('disappearance', 'missing_run') ORDER BY dt, brand");
    expect(flags.length).toBe(1);
    expect(cell(flags[0], "brand")).toBe("nike");
    expect(cell(flags[0], "dt")).toBe("2026-09-08");
    // adidas only ever ran on day 9: days 1-8 are "not yet monitored", not missing
  });

  it("detects a first-seen advertiser as a new entrant", async () => {
    const entrants = await rows("SELECT * FROM gold_anomalies WHERE kind = 'new_entrant' ORDER BY dt, entity");
    const entities = entrants.map((r) => `${cell(r, "dt")}:${cell(r, "entity")}`);
    expect(entities).toContain("2026-09-09:newbie-shop.com");
    expect(entities).toContain("2026-09-09:reseller.io");
    // cold start: regular.com's first-ever sighting on day 1 is also an entrant
    expect(entities).toContain("2026-09-01:regular.com");
    // and by day 2 it is no longer one
    expect(entities.filter((e) => e.includes("regular.com")).length).toBe(1);
  });

  it("surfaces broken landings as dqi findings and escalates them", async () => {
    const dqi = await rows("SELECT * FROM silver_dqi WHERE brand = 'adidas' ORDER BY check_name");
    const checks = dqi.map((r) => cell(r, "check_name"));
    expect(checks).toContain("landing_error");
    expect(checks).toContain("landing_http_403");
    expect(checks).toContain("hop_failed");
    const escalated = await rows("SELECT * FROM gold_anomalies WHERE brand = 'adidas' AND kind = 'data_quality'");
    expect(escalated.length).toBe(dqi.length);
  });

  it("gold_daily carries metrics plus anomaly context", async () => {
    const day9 = await rows("SELECT * FROM gold_daily WHERE dt = DATE '2026-09-09' AND brand = 'nike'");
    expect(cell(day9[0], "ads_seen")).toBe("2");
    expect(cell(day9[0], "advertisers_n")).toBe("2");
    const flags = String(day9[0]?.anomaly_flags);
    expect(flags).toContain("new_entrant");
    const day8 = await rows("SELECT * FROM gold_daily WHERE dt = DATE '2026-09-08' AND brand = 'nike'");
    expect(String(day8[0]?.anomaly_flags)).toContain("disappearance");
    expect(Array.isArray(day8[0]?.new_entrants)).toBe(true);
    expect((day8[0]?.new_entrants as string[]).length).toBe(0);
  });

  it("exports gold as dt-partitioned parquet that reads back", async () => {
    const back = await rows(`SELECT * FROM read_parquet('${curatedLake}/gold/daily_brand_keyword/**/*.parquet', hive_partitioning=true)`);
    expect(back.length).toBe(18);
    const dts = new Set(back.map((r) => cell(r, "dt")));
    expect(dts.has("2026-09-09")).toBe(true);
    const ev = await rows(`SELECT * FROM read_parquet('${curatedLake}/gold/evidence/**/*.parquet', hive_partitioning=true) WHERE brand = 'nike' AND dt = DATE '2026-09-09' AND ad_index = 0`);
    expect(String(ev[0]?.evidence)).toContain("domain regular.com/offer (ad_meta)");
  });
});

describe("transform on a fresh lake", () => {
  it("tolerates an empty landings prefix via the seed fallback", async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), "bw-fresh-"));
    const raw2 = path.join(root2, "raw").replaceAll("\\", "/");
    const cur2 = path.join(root2, "curated").replaceAll("\\", "/");
    try {
      // runs + observations exist, but no landing was ever inspected
      const runDir = path.join(root2, "raw", "raw", "engine=bing", "dt=2026-09-01", "run=run_fresh");
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, "meta.json"), meta("run_fresh", "2026-09-01", 1));
      const obsDir = path.join(root2, "curated", "curated", "observations", "dt=2026-09-01");
      mkdirSync(obsDir, { recursive: true });
      writeFileSync(path.join(obsDir, "run_fresh.jsonl"), obs("run_fresh", "2026-09-01", 0, "regular.com", "unknown") + "\n");
      for (const table of ["daily_brand_keyword", "anomalies", "evidence"]) {
        mkdirSync(path.join(root2, "curated", "gold", table), { recursive: true });
      }

      const instance2 = await DuckDBInstance.create(":memory:");
      const conn2 = await instance2.connect();
      const files = await runTransform(conn2, { rawLake: raw2, curatedLake: cur2 });
      expect(files.length).toBeGreaterThan(10);

      const q = async (sql: string) => (await conn2.runAndReadAll(sql)).getRowObjectsJson();
      expect(Number((await q("SELECT count(*) AS n FROM silver_landings"))[0]?.n)).toBe(0);
      expect(Number((await q("SELECT count(*) AS n FROM silver_runs"))[0]?.n)).toBe(1);
      const daily = await q(`SELECT * FROM read_parquet('${cur2}/gold/daily_brand_keyword/**/*.parquet', hive_partitioning=true)`);
      expect(daily.length).toBe(1);
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });
});
