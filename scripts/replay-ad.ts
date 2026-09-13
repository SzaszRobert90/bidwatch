/**
 * Replay ad-click analysis through the CURRENT pipeline logic, offline.
 *
 *   npx tsx scripts/replay-ad.ts                    # the real couponsmith ad from 2026-09-09
 *   npx tsx scripts/replay-ad.ts <aclick-url>       # any bing.com/aclick url
 *   npx tsx scripts/replay-ad.ts --lake [runId]     # re-classify historical landing rows in MinIO
 *       lake mode env: BIDWATCH_S3_ENDPOINT (default http://localhost:9000),
 *       AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, BIDWATCH_CURATED_BUCKET
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { resolveAclickTarget } from "../src/domain/aclick.js";
import { matchSignatures } from "../src/adapters/landing/match.js";
import { classifyLanding } from "../src/domain/domain.js";
import { loadEnv, loadSignatures } from "../src/config.js";
import type { LandingRow, SerpQuery, SignatureMatch } from "../src/domain/types.js";

/** Real `u=` param captured 2026-09-09 on a couponsmith nordvpn ad (bing search "nordvpn coupon"). */
const COUPONSMITH_U =
  "aHR0cHMlM2ElMmYlMmZjb3Vwb25zbWl0aC5jb20lMmZ1cy1lbiUyZnByb21vLWNvZGVzJTJmbm9yZHZwbiUzZnVybCUzZGh0dHBzJTI1M0ElMjUyRiUyNTJGY291cG9uc21pdGguY29tJTI1MkZ1cy1lbiUyNTJGcHJvbW8tY29kZXMlMjUyRm5vcmR2cG4lMjZkZXZpY2UlM2RjJTI2bmV0d29yayUzZG8lMjZjYW1wYWlnbiUzZDUyNDMxNzg3OCUyNmt3ZCUzZG5vcmR2cG4lMjUyMGNvdXBvbiUyNm1lZGl1bSUzZGNwYyUyNmFkZ3JvdXBpZCUzZDEzMTM5MTkzMTM2NzEyMDElMjZsb2NfaW50ZXJlc3QlM2QlMjZsb2NfcGh5c2ljYWwlM2QyMjQlMjZ0YXJnZXRpZCUzZGt3ZC04MjEyMTY4ODIxMzUwMyUyNm1hdGNodHlwZSUzZGUlMjZtc2Nsa2lkJTNkYWJlMzRiNzkyNTIzMTg1ZTBhOWEyMWQ4YTBjYTRmYTQlMjZ1dG1fc291cmNlJTNkYmluZyUyNnV0bV9tZWRpdW0lM2RjcGMlMjZ1dG1fY2FtcGFpZ24lM0ROb3JkJTI1MjAlZTIlODclODYlMjUyMENTJTI1MjAlZTIlODclODYlMjUyMEFkbWl0YWQlMjUyMChsbWMpJTI2dXRtX3Rlcm0lM2Rub3JkdnBuJTI1MjBjb3Vwb24lMjZ1dG1fY29udGVudCUzZE5vcmQlMjUyMCVlMiU5ZSVhNSUyNTIwQ1M";

const signatures = loadSignatures(loadEnv({}));

function analyzeAdMeta(clickUrl: string): { destination: string | null; matches: SignatureMatch[] } {
  const destination = resolveAclickTarget(clickUrl);
  if (destination === null) return { destination: null, matches: [] };
  const matches = matchSignatures(signatures, { urls: [destination], body: null }).map(
    (m) => ({ ...m, source: "ad_meta" as const }),
  );
  return { destination, matches };
}

function singleUrlMode(clickUrl: string): void {
  console.log(`click url: ${clickUrl.slice(0, 100)}${clickUrl.length > 100 ? "…" : ""}`);
  const { destination, matches } = analyzeAdMeta(clickUrl);
  if (destination === null) {
    console.log("→ no decodable u= destination (not a bing aclick url, or u= missing/garbage)");
    return;
  }
  console.log(`\ndecoded destination:\n  ${destination}`);
  console.log(`\nsignature matches on ad metadata: ${matches.length}`);
  for (const m of matches) console.log(`  [${m.network}] ${m.kind}/${m.source}: ${m.evidence}`);
  console.log(`\nverdict: ${matches.length > 0 ? "AFFILIATE VIOLATION (evidence in Bing's own ad metadata)" : "no network signature in ad metadata"}`);
}

function fakeQuery(row: LandingRow): SerpQuery {
  return {
    runId: row.runId, brand: row.brand, brandDomain: "", keyword: row.keyword,
    geo: row.geo, engine: row.engine, enqueuedAt: "",
  };
}

/** Re-run classification over historical curated rows as the current code would. */
async function lakeMode(runId: string | undefined): Promise<void> {
  const endpoint = process.env.BIDWATCH_S3_ENDPOINT ?? "http://localhost:9000";
  const bucket = process.env.BIDWATCH_CURATED_BUCKET ?? "bidwatch-curated";
  const client = new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint,
    forcePathStyle: true,
  });

  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "curated/landings/" }));
  const keys = (listed.Contents ?? []).map((o) => o.Key!).filter((k) => !runId || k.includes(`run=${runId}.jsonl`));
  if (keys.length === 0) {
    console.log(`no landing objects under s3://${bucket}/curated/landings/ at ${endpoint}${runId ? ` for ${runId}` : ""}`);
    return;
  }

  let flips = 0;
  for (const key of keys) {
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const rows = (await obj.Body.transformToString()).trim().split("\n").map((l) => JSON.parse(l) as LandingRow);
    for (const row of rows) {
      const { destination, matches } = analyzeAdMeta(row.clickUrl);
      const mergedMatches: SignatureMatch[] = [...row.inspection.matches, ...matches];
      const newClassification = classifyLanding(fakeQuery(row), {
        adIndex: row.adIndex, title: row.title, description: null,
        displayUrl: "", displayDomain: row.displayDomain, clickUrl: row.clickUrl,
      }, { ...row.inspection, adMetaUrl: destination, matches: mergedMatches });
      const changed = newClassification !== row.classification;
      flips += changed ? 1 : 0;
      const networks = [...new Set([...row.networks, ...matches.map((m) => m.network)])];
      console.log(
        `${changed ? "*" : " "} [${row.adIndex}] ${row.displayDomain || "?"}\n` +
        `    ${row.classification} → ${newClassification}` +
        (networks.length ? `  networks: ${networks.join(",")}` : "") +
        (destination ? `\n    ad_meta: ${destination.slice(0, 90)}` : ""),
      );
      for (const m of matches) console.log(`    new evidence: [${m.network}] ${m.evidence}`);
    }
  }
  console.log(`\n${keys.length} object(s) replayed, ${flips} classification flip(s).`);
  console.log("(the lake is immutable — rows shown are recomputed in memory; new runs store ad_meta natively)");
}

const arg = process.argv[2];
if (arg === "--lake") {
  await lakeMode(process.argv[3]);
} else if (arg !== undefined && arg !== "") {
  singleUrlMode(arg);
} else {
  singleUrlMode(`https://www.bing.com/aclick?ld=e8REPLAY&u=${COUPONSMITH_U}&rlid=abe34b792523185e0a9a21d8a0ca4fa4&ntb=1`);
}
