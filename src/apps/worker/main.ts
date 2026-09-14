import { loadEnv } from "../../config.js";
import { wire } from "../../compose.js";
import { bidwatchMetrics } from "../../metrics.js";
import { meter, startHeartbeat, startTelemetry } from "../../telemetry.js";
import { processJob, type PipelineDeps } from "./pipeline.js";
import type { QueueMessage } from "../../domain/ports.js";

/** Worker loop: receive -> process -> delete. `--once` drains the queue then exits. */
export async function main(): Promise<void> {
  const env = loadEnv();
  const tel = startTelemetry("bidwatch-worker");
  const { provider, inspector, queue, store, signatures, log } = wire(env);
  await queue.ensureQueues();

  // Queue and DLQ depths are polled whenever the metric reader collects
  // (60s cadence, plus once at shutdown), not per loop — ElasticMQ is local,
  // but this stays cheap against real SQS too.
  const m = meter();
  const depthGauge = m.createObservableGauge("bidwatch.queue.depth");
  depthGauge.addCallback(async (result) => {
    try {
      result.observe(await queue.approximateCount());
    } catch {
      // gauge is unobserved this cycle; the next collect retries
    }
  });
  const dlqGauge = m.createObservableGauge("bidwatch.dlq.depth");
  dlqGauge.addCallback(async (result) => {
    try {
      result.observe(await queue.dlqCount());
    } catch {
      // as above
    }
  });

  const deps: PipelineDeps = {
    provider,
    inspector,
    store,
    signatures,
    rawBucket: env.BIDWATCH_RAW_BUCKET,
    curatedBucket: env.BIDWATCH_CURATED_BUCKET,
    maxLandings: env.BIDWATCH_MAX_LANDINGS,
    politenessMs: env.BIDWATCH_POLITENESS_MS,
    mode: env.BIDWATCH_MODE,
    log: (msg, rest) => log.info(rest ?? {}, msg),
  };

  const metrics = bidwatchMetrics();
  const once = process.argv.includes("--once") || env.BIDWATCH_WORKER_ONCE === "1";
  let running = true;
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  if (!once) startHeartbeat();

  try {
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
      for (const msg of messages) {
        try {
          await processJob(deps, msg.job);
          await queue.remove(msg.handle);
          metrics.jobs.add(1, { outcome: "ok" });
        } catch (err) {
          metrics.jobs.add(1, { outcome: "error" });
          log.error({ err, runId: msg.job.runId }, "job failed; left for retry/redrive");
        }
      }
      if (once) break;
    }
  } finally {
    await provider.dispose?.();
    // Flush spans/metrics/logs before exit — for batch (--once) runs this is
    // the only chance the exporters get.
    await tel.shutdown();
    log.info("worker exiting");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
