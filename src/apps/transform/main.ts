import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnv } from "../../config.js";
import { makeLogger } from "../../compose.js";
import { applyS3Settings } from "../../duckdb/settings.js";
import { runTransform } from "../../duckdb/transform.js";
import { bidwatchMetrics } from "../../metrics.js";
import { startTelemetry, withSpan } from "../../telemetry.js";

/**
 * Transform app: bronze -> silver -> gold in DuckDB SQL (sql/*.sql), exporting
 * gold as Parquet into the curated bucket. Every run is a full recompute from
 * immutable bronze — idempotent, so it is safe to rerun any time; the report
 * service chains it ahead of the report app. Each SQL file is a child span,
 * so a slow or failing stage is visible in the run's trace.
 */
export async function main(): Promise<void> {
  const env = loadEnv();
  const tel = startTelemetry("bidwatch-transform");
  const log = makeLogger();
  const metrics = bidwatchMetrics();
  try {
    const files = await withSpan("transform.run", {}, async (span) => {
      const instance = await DuckDBInstance.create(":memory:");
      const conn = await instance.connect();
      await conn.run("INSTALL httpfs; LOAD httpfs;");
      await applyS3Settings(conn, env);

      const files = await runTransform(conn, {
        rawLake: `s3://${env.BIDWATCH_RAW_BUCKET}`,
        curatedLake: `s3://${env.BIDWATCH_CURATED_BUCKET}`,
      });
      span.setAttribute("sql_files", files.length);
      return files;
    });
    metrics.runComplete.add(1, { app: "transform" });
    log.info(`transform complete (${files.length} sql files) -> s3://${env.BIDWATCH_CURATED_BUCKET}/gold/`);
  } finally {
    await tel.shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
