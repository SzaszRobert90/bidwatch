import { DuckDBInstance } from "@duckdb/node-api";
import { loadEnv } from "../../config.js";
import { applyS3Settings } from "../../duckdb/settings.js";
import { runTransform } from "../../duckdb/transform.js";

/**
 * Transform app: bronze -> silver -> gold in DuckDB SQL (sql/*.sql), exporting
 * gold as Parquet into the curated bucket. Every run is a full recompute from
 * immutable bronze — idempotent, so it is safe to rerun any time; the report
 * service chains it ahead of the report app.
 */
export async function main(): Promise<void> {
  const env = loadEnv();
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs;");
  await applyS3Settings(conn, env);

  const files = await runTransform(conn, {
    rawLake: `s3://${env.BIDWATCH_RAW_BUCKET}`,
    curatedLake: `s3://${env.BIDWATCH_CURATED_BUCKET}`,
  });
  console.log(`transform complete (${files.length} sql files) -> s3://${env.BIDWATCH_CURATED_BUCKET}/gold/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
