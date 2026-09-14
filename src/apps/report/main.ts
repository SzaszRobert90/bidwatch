import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { loadEnv } from "../../config.js";
import { makeLogger } from "../../compose.js";
import { S3ResultStore } from "../../adapters/store/s3.js";
import { applyS3Settings } from "../../duckdb/settings.js";
import { bidwatchMetrics } from "../../metrics.js";
import { startTelemetry, withSpan } from "../../telemetry.js";

/**
 * Report app: renders the gold layer (written by the transform app) into
 * per-brand evidence packs (markdown) and a prospect ranking (CSV) in the
 * reports bucket. Reads only gold Parquet — never the JSONL lake. All values
 * reach SQL as query parameters, never interpolated strings.
 */
export async function main(): Promise<void> {
  const env = loadEnv();
  const tel = startTelemetry("bidwatch-report");
  const log = makeLogger();
  const metrics = bidwatchMetrics();
  const date = argAfter("--date") ?? new Date().toISOString().slice(0, 10);

  try {
    await withSpan("report.run", { date }, async () => {
      const instance = await DuckDBInstance.create(":memory:");
      const conn = await instance.connect();
      await conn.run("INSTALL httpfs; LOAD httpfs;");
      await applyS3Settings(conn, env);

      const curated = env.BIDWATCH_CURATED_BUCKET;
      const gold: Array<[string, string]> = [
        ["gold_daily", "gold/daily_brand_keyword"],
        ["gold_anomalies", "gold/anomalies"],
        ["gold_evidence", "gold/evidence"],
      ];
      for (const [view, prefix] of gold) {
        await conn.run(
          `CREATE OR REPLACE VIEW ${view} AS
           SELECT * FROM read_parquet('s3://${curated}/${prefix}/**/*.parquet', hive_partitioning=true)`,
        );
      }

      const store = new S3ResultStore({
        endpoint: env.BIDWATCH_S3_ENDPOINT || undefined,
        forcePathStyle: env.BIDWATCH_S3_ENDPOINT !== "",
      });

      let prospects: Array<Record<string, unknown>>;
      try {
        prospects = await query(
          conn,
          `SELECT brand,
                  sum(violations) AS violations_7d,
                  sum(conquests)  AS conquests_7d,
                  max(dt)         AS last_seen
           FROM gold_daily
           WHERE dt >= current_date - INTERVAL 7 DAY AND runs_seen > 0
           GROUP BY brand
           ORDER BY violations_7d DESC, conquests_7d DESC`,
        );
      } catch {
        // Views are lazy: this is where "the parquet isn't there yet" surfaces.
        log.info("no gold data yet (transform has not run?); nothing to report");
        return;
      }
      if (prospects.length === 0) {
        log.info("no runs in the last 7 days; nothing to report");
        return;
      }

      const csv = [
        "brand,violations_7d,conquests_7d,last_seen",
        ...prospects.map((r) => `${r.brand},${r.violations_7d},${r.conquests_7d},${String(r.last_seen).slice(0, 10)}`),
      ].join("\n");
      await store.putText(`${env.BIDWATCH_REPORTS_BUCKET}/reports/prospect-ranking-${date}.csv`, csv + "\n", "text/csv");
      log.info(`wrote prospect-ranking-${date}.csv (${prospects.length} brands)`);
      metrics.runComplete.add(1, { app: "report" });

      for (const row of prospects) {
        const findings = await query(
          conn,
          `SELECT keyword, ad_index, classification, networks, title, display_domain,
                  final_domain, inspection_error, evidence
           FROM gold_evidence
           WHERE brand = $brand AND dt = CAST($date AS DATE)
           ORDER BY CASE classification WHEN 'affiliate_violation' THEN 0 ELSE 1 END, ad_index`,
          { brand: String(row.brand), date },
        );
        if (findings.length === 0) continue;
        const md = renderBrandPack(String(row.brand), date, findings);
        await store.putText(
          `${env.BIDWATCH_REPORTS_BUCKET}/reports/${date}/${row.brand}.md`,
          md,
          "text/markdown; charset=utf-8",
        );
        log.info(`wrote ${date}/${row.brand}.md (${findings.length} rows)`);
      }
    });
  } finally {
    await tel.shutdown();
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
    lines.push(`## ${f.classification} — "${f.keyword}" [pos ${f.ad_index}]`);
    lines.push(`- ad: ${f.title} (display: ${f.display_domain})`);
    lines.push(`- landing final domain: ${f.final_domain ?? "?"}${f.inspection_error ? ` — error: ${f.inspection_error}` : ""}`);
    if (Array.isArray(f.networks) && f.networks.length > 0) {
      lines.push(`- networks: ${(f.networks as string[]).join(", ")}`);
    }
    lines.push(...evidence.map((e) => `- evidence: ${e}`));
    lines.push("");
  }
  return lines.join("\n");
}

async function query(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  sql: string,
  params: Record<string, DuckDBValue> = {},
): Promise<Array<Record<string, unknown>>> {
  const result = await conn.runAndReadAll(sql, params);
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
