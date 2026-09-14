import { metrics } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPMetricExporter, AggregationTemporalityPreference } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

/**
 * Canary for the metrics pipeline. Builds the same exporter configuration
 * src/telemetry.ts uses (stock cumulative temporality), adds 1 to a counter,
 * exports twice (1s interval), and exits. Then read the stored samples:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npx tsx scripts/probe-otel-temporality.ts
 *   # raw samples of bidwatch_probe_total: expect `1 2` (cumulative, accepted).
 *   # nothing stored + collector 500 "invalid temporality" = something started
 *   # exporting deltas again — Prometheus's OTLP receiver rejects them.
 *
 * Background: every bidwatch app is a short-lived batch process, so each run
 * exports its cumulative counters as its OWN series (random service.instance.id
 * in src/telemetry.ts) and dashboards sum per-process finals with
 * sum(max_over_time(metric[W])). Plain delta was tried first and is a dead end
 * here: Prometheus rejects delta OTLP writes, and the collector's
 * deltatocumulative processor resets on each new process stream instead of
 * chaining across runs (verified empirically, 2026-09-14).
 */
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
if (endpoint === "") {
  console.error("set OTEL_EXPORTER_OTLP_ENDPOINT (e.g. http://localhost:4318)");
  process.exit(1);
}

const sdk = new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${endpoint.replace(/\/+$/, "")}/v1/metrics`,
      temporalityPreference: AggregationTemporalityPreference.DELTA,
    }),
    exportIntervalMillis: 1_000,
  }),
});
sdk.start();

const probe = metrics.getMeter("bidwatch").createCounter("bidwatch.probe");
probe.add(1);
console.log("probe: added 1 — first export due ~1s");
await new Promise((r) => setTimeout(r, 1_500));
probe.add(1);
console.log("probe: added another 1 — second export due ~1s, then exit");
await new Promise((r) => setTimeout(r, 1_500));
console.log("probe: done — check raw samples of bidwatch_probe_total (1 2 = delta, 1 2 = cumulative)");
await sdk.shutdown();
