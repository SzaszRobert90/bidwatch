import type { DuckDBConnection } from "@duckdb/node-api";
import type { Env } from "../config.js";

export type S3SettingsEnv = Pick<Env, "BIDWATCH_S3_ENDPOINT" | "BIDWATCH_S3_USE_SSL" | "AWS_REGION">;

/**
 * Point DuckDB's httpfs at MinIO (path-style addressing, credentials from the
 * environment). An empty endpoint means real AWS: leave defaults so the
 * instance role / default credential chain applies.
 */
export function applyS3Settings(conn: DuckDBConnection, env: S3SettingsEnv): Promise<void> {
  return (async () => {
    if (env.BIDWATCH_S3_ENDPOINT === "") return;
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
