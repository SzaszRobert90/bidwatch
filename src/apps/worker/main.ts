import { loadEnv } from "../../config.js";
import { wire } from "../../compose.js";
import { processJob, type PipelineDeps } from "./pipeline.js";
import type { QueueMessage } from "../../domain/ports.js";

/** Worker loop: receive -> process -> delete. `--once` drains the queue then exits. */
export async function main(): Promise<void> {
  const env = loadEnv();
  const { provider, inspector, queue, store, log } = wire(env);
  await queue.ensureQueues();

  const deps: PipelineDeps = {
    provider,
    inspector,
    store,
    rawBucket: env.BIDWATCH_RAW_BUCKET,
    curatedBucket: env.BIDWATCH_CURATED_BUCKET,
    maxLandings: env.BIDWATCH_MAX_LANDINGS,
    politenessMs: env.BIDWATCH_POLITENESS_MS,
    log: (msg, rest) => log.info(rest ?? {}, msg),
  };

  const once = process.argv.includes("--once") || env.BIDWATCH_WORKER_ONCE === "1";
  let running = true;
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });

  while (running) {
    let messages: QueueMessage[];
    try {
      messages = await queue.receive(10, once ? 3 : 20);
    } catch (err) {
      // A transient queue blip (e.g. ElasticMQ 503 with a non-JSON body) must
      // not kill the worker — log, back off, and keep polling.
      log.error({ err }, "queue receive failed; backing off 5s");
      await new Promise((r) => setTimeout(r, 5_000));
      if (once) break;
      continue;
    }
    if (messages.length === 0) {
      if (once) break;
      continue;
    }
    log.info(`received ${messages.length} job(s)`);
    for (const m of messages) {
      try {
        await processJob(deps, m.job);
        await queue.remove(m.handle);
      } catch (err) {
        log.error({ err, runId: m.job.runId }, "job failed; left for retry/redrive");
      }
    }
    if (once) break;
  }
  await provider.dispose?.();
  log.info("worker exiting");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
