import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { loadBrands, loadEnv, type BrandConfig, type Env } from "../../config.js";
import { wire } from "../../compose.js";
import { slug } from "../../adapters/fixture/fixture.js";
import { bidwatchMetrics } from "../../metrics.js";
import { startHeartbeat, startTelemetry, withSpan } from "../../telemetry.js";
import type { SerpQuery } from "../../domain/types.js";

/** Feeder: enqueue {brand, keyword} jobs. `--once` feeds and exits; otherwise runs on cron. */
export async function main(): Promise<void> {
  const env = loadEnv();
  const tel = startTelemetry("bidwatch-feeder");
  const { queue, log } = wire(env);
  const metrics = bidwatchMetrics();
  let brands = loadBrands(env);
  if (env.BIDWATCH_MODE === "fixture") {
    brands = brands.filter((b) =>
      b.keywords.every((kw) =>
        existsSync(
          path.join(env.BIDWATCH_FIXTURES_DIR, "serps", b.key, `${slug(kw.replaceAll("{brand}", b.key))}.html`),
        ),
      ),
    );
  }
  await queue.ensureQueues();

  const feed = async (): Promise<void> => {
    await withSpan("feed.run", { brands: brands.length }, async (span) => {
      const jobs = expandJobs(env, brands);
      for (const job of jobs) {
        await queue.send(job);
      }
      span.setAttribute("jobs", jobs.length);
      metrics.runComplete.add(1, { app: "feeder" });
      log.info(`fed ${jobs.length} jobs for ${brands.length} brands`);
    });
  };

  const once = process.argv.includes("--once");
  try {
    if (once) {
      await feed();
      return;
    }
    startHeartbeat();
    log.info(`feeder scheduling on cron "${env.BIDWATCH_FEEDER_CRON}"`);
    // Fire once at startup so a freshly deployed stack produces data immediately,
    // then stay on schedule.
    await feed();
    cron.schedule(env.BIDWATCH_FEEDER_CRON, () => {
      feed().catch((err) => log.error({ err }, "feed failed"));
    });
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      log.info("feeder stopping");
      tel.shutdown().finally(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } finally {
    if (once) await tel.shutdown();
  }
}

export function expandJobs(env: Env, brands: BrandConfig[]): SerpQuery[] {
  const jobs: SerpQuery[] = [];
  const now = new Date().toISOString();
  for (const brand of brands) {
    for (const template of brand.keywords) {
      const keyword = template.replaceAll("{brand}", brand.key);
      jobs.push({
        runId: `run_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
        brand: brand.key,
        brandDomain: brand.domain,
        keyword,
        geo: brand.geo,
        engine: "bing",
        enqueuedAt: now,
      });
    }
  }
  return jobs;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
