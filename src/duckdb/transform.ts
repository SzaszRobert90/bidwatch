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
  /** Dir with seed rows; defaults to `sql/seeds` in the repo. */
  seedsDir?: string;
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

/** The three bronze inputs: a placeholder in the SQL, the lake glob it reads, and the seed that stands in when the prefix is empty. */
const BRONZE: Array<{ placeholder: string; glob: (s: TransformSources) => string; seed: string }> = [
  { placeholder: "__RUNS_SOURCE__", glob: (s) => `${s.rawLake}/raw/engine=*/dt=*/run=*/meta.json`, seed: "runs.json" },
  { placeholder: "__OBSERVATIONS_SOURCE__", glob: (s) => `${s.curatedLake}/curated/observations/**/*.jsonl`, seed: "observations.jsonl" },
  { placeholder: "__LANDINGS_SOURCE__", glob: (s) => `${s.curatedLake}/curated/landings/**/*.jsonl`, seed: "landings.jsonl" },
];

/**
 * Executes sql/*.sql in filename order — the number prefixes are the dependency
 * graph. One statement per file keeps the runner trivial (DuckDB's node API
 * refuses multi-statement strings) and makes each file reviewable on its own.
 * Each bronze source resolves to the lake glob when the prefix holds objects,
 * else to the shipped seed file, because read_json refuses empty globs and a
 * fresh lake (CI, the AWS migration) must transform cleanly. The seed row only
 * types the relation; the views filter it out by its own filename. The
 * connection must already have S3 settings applied when sources point at s3://.
 */
export async function runTransform(conn: DuckDBConnection, sources: TransformSources): Promise<string[]> {
  const dir = join(repoRoot(), "sql");
  const seedsDir = (sources.seedsDir ?? join(dir, "seeds")).replaceAll("\\", "/");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const values = new Map<string, string>([
    ["__RAW_LAKE__", sources.rawLake],
    ["__CURATED_LAKE__", sources.curatedLake],
  ]);
  for (const b of BRONZE) {
    values.set(b.placeholder, await sourceOr(conn, b.glob(sources), join(seedsDir, b.seed)));
  }

  for (const file of files) {
    let sql = readFileSync(join(dir, file), "utf8");
    for (const [placeholder, value] of values) sql = sql.replaceAll(placeholder, value);
    await conn.run(sql);
  }
  return files;
}

/** The lake glob when the prefix has objects, else the seed file path. */
async function sourceOr(conn: DuckDBConnection, globPattern: string, seedPath: string): Promise<string> {
  const pattern = globPattern.replaceAll("'", "''");
  const result = await conn.runAndReadAll(`SELECT count(*) AS n FROM glob('${pattern}')`);
  const n = Number(result.getRowObjectsJson()[0]?.n ?? 0);
  return n > 0 ? globPattern : seedPath.replaceAll("\\", "/");
}
