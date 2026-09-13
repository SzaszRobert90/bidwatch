import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnv } from "../../config.js";
import { S3ResultStore } from "../../adapters/store/s3.js";

/**
 * Report app: DuckDB over the curated lake (httpfs -> MinIO/S3), rendering
 * per-brand evidence packs (markdown) and a prospect ranking (CSV) into the
 * reports bucket.
 */
export async function main(): Promise<void> {
  const env = loadEnv();
  const date = argAfter("--date") ?? new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs;");
  await applyS3Settings(conn, env);

  const curated = env.BIDWATCH_CURATED_BUCKET;
  await conn.run(
    `CREATE OR REPLACE VIEW observations AS
     SELECT * FROM read_json('s3://${curated}/curated/observations/**/*.jsonl', format='newline_delimited')`,
  );
  await conn.run(
    `CREATE OR REPLACE VIEW landings AS
     SELECT * FROM read_json('s3://${curated}/curated/landings/**/*.jsonl', format='newline_delimited')`,
  );

  const store = new S3ResultStore({
    endpoint: env.BIDWATCH_S3_ENDPOINT || undefined,
    forcePathStyle: env.BIDWATCH_S3_ENDPOINT !== "",
  });

  const prospects = await query(
    conn,
    `SELECT brand,
            count(*) FILTER (WHERE "classification" = 'affiliate_violation') AS violations,
            count(*) FILTER (WHERE "classification" = 'competitor_conquest') AS conquests,
            max("fetchedAt") AS lastSeen
     FROM landings
     WHERE substr(CAST("fetchedAt" AS VARCHAR), 1, 10) >= '${weekAgo}'
     GROUP BY brand
     ORDER BY violations DESC, conquests DESC`,
  );
  if (prospects.length === 0) {
    console.log("no landing data in the lake yet; nothing to report");
    return;
  }

  const csv = [
    "brand,violations_7d,conquests_7d,last_seen",
    ...prospects.map((r) => `${r.brand},${r.violations},${r.conquests},${String(r.lastSeen).slice(0, 10)}`),
  ].join("\n");
  await store.putText(`${env.BIDWATCH_REPORTS_BUCKET}/reports/prospect-ranking-${date}.csv`, csv + "\n", "text/csv");
  console.log(`wrote prospect-ranking-${date}.csv (${prospects.length} brands)`);

  for (const row of prospects) {
    const findings = await query(
      conn,
      `SELECT "keyword", "adIndex", "classification", "networks", "title", "displayDomain",
              "inspection"['finalDomain'] AS finalDomain,
              "inspection"['error'] AS error,
              list_transform("inspection"['matches'], m -> m['evidence'] || ' (' || m['source'] || ')') AS evidence
       FROM landings
       WHERE brand = '${row.brand}' AND substr(CAST("fetchedAt" AS VARCHAR), 1, 10) = '${date}'
       ORDER BY CASE "classification" WHEN 'affiliate_violation' THEN 0 ELSE 1 END, "adIndex"`,
    );
    if (findings.length === 0) continue;
    const md = renderBrandPack(String(row.brand), date, findings);
    await store.putText(
      `${env.BIDWATCH_REPORTS_BUCKET}/reports/${date}/${row.brand}.md`,
      md,
      "text/markdown; charset=utf-8",
    );
    console.log(`wrote ${date}/${row.brand}.md (${findings.length} rows)`);
  }
}

function renderBrandPack(
  brand: string,
  date: string,
  findings: Array<Record<string, unknown>>,
): string {
  const lines: string[] = [
    `# bidwatch evidence pack — ${brand} (${date})`,
    "",
    "Classified ad landings observed on Bing for this brand's keywords.",
    "`affiliate_violation` rows carry network matches — the evidence chain an affiliate manager can act on.",
    "",
  ];
  for (const f of findings) {
    const evidence = (f.evidence as string[] | null) ?? [];
    lines.push(`## ${f.classification} — "${f.keyword}" [pos ${f.adIndex}]`);
    lines.push(`- ad: ${f.title} (display: ${f.displayDomain})`);
    lines.push(`- landing final domain: ${f.finalDomain ?? "?"}${f.error ? ` — error: ${f.error}` : ""}`);
    if (Array.isArray(f.networks) && f.networks.length > 0) {
      lines.push(`- networks: ${(f.networks as string[]).join(", ")}`);
    }
    lines.push(...evidence.map((e) => `- evidence: ${e}`));
    lines.push("");
  }
  return lines.join("\n");
}

function applyS3Settings(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  env: ReturnType<typeof loadEnv>,
): Promise<void> {
  return (async () => {
    if (env.BIDWATCH_S3_ENDPOINT === "") return; // real AWS: default endpoints + instance role
    const hostPort = env.BIDWATCH_S3_ENDPOINT.replace(/^https?:\/\//, "");
    const settings: Array<[string, string]> = [
      ["s3_endpoint", hostPort],
      ["s3_access_key_id", process.env.AWS_ACCESS_KEY_ID ?? "local"],
      ["s3_secret_access_key", process.env.AWS_SECRET_ACCESS_KEY ?? "local"],
      ["s3_use_ssl", env.BIDWATCH_S3_USE_SSL],
      ["s3_url_style", "path"],
      ["s3_region", env.AWS_REGION],
    ];
    for (const [name, value] of settings) {
      await conn.run(`SET ${name}='${value}'`);
    }
  })();
}

async function query(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await conn.runAndReadAll(sql);
  return result.getRowObjectsJson();
}

function argAfter(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
