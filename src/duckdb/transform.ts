import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DuckDBConnection } from "@duckdb/node-api";

/** Where the SQL reads bronze from and where gold is exported to. Either may be an `s3://` bucket root or a local directory (tests). */
export interface TransformSources {
  /** Root containing `raw/engine=.../dt=.../run=.../meta.json`. */
  rawLake: string;
  /** Root containing `curated/observations|landings/**` and receiving `gold/`. */
  curatedLake: string;
}

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`repo root not found above ${dir}`);
    dir = parent;
  }
}

/**
 * Executes sql/*.sql in filename order — the number prefixes are the dependency
 * graph. One statement per file keeps the runner trivial (DuckDB's node API
 * refuses multi-statement strings) and makes each file reviewable on its own.
 * Placeholders are substituted before execution: COPY needs literal paths, so
 * SET VARIABLE alone cannot parameterize the export targets.
 */
export async function runTransform(conn: DuckDBConnection, sources: TransformSources): Promise<string[]> {
  const dir = join(repoRoot(), "sql");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8")
      .replaceAll("__RAW_LAKE__", sources.rawLake)
      .replaceAll("__CURATED_LAKE__", sources.curatedLake);
    await conn.run(sql);
  }
  return files;
}
