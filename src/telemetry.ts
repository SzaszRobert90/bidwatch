import { metrics, trace, SpanStatusCode, type Attributes, type Meter, type Span, type Tracer } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader, AggregationTemporality } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";

/**
 * OpenTelemetry wiring: OTLP/HTTPS (or plain HTTP against a local collector)
 * traces + metrics + logs. Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set, so
 * dev, CI and tests never emit anything. Apps call startTelemetry() once at
 * startup and shutdown() before exiting — the flush matters for batch runs,
 * whose spans and metrics would otherwise never leave the process.
 * Adapters never import this module; they reach tracer()/meter() through
 * @opentelemetry/api globals, which are no-ops until the SDK starts.
 */

export interface Telemetry {
  /** Flushes and stops all exporters. Safe to call more than once. */
  shutdown(): Promise<void>;
}

/** True when telemetry is configured (OTEL_EXPORTER_OTLP_ENDPOINT non-empty). */
export function telemetryEnabled(): boolean {
  return (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim().length > 0;
}

/** OTLP endpoint with any trailing slash removed, for path joining. */
export function otlpEndpoint(): string {
  return (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim().replace(/\/+$/, "");
}

export function startTelemetry(serviceName: string): Telemetry {
  const endpoint = otlpEndpoint();
  if (endpoint === "") return { shutdown: async () => {} };

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "deployment.environment": process.env.BIDWATCH_MODE ?? "live",
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 60_000,
      // Delta, not cumulative: every app here is short-lived (batch runs exit
      // in seconds), and successive processes exporting cumulative counters
      // would read as a flat series in Prometheus. Deltas add up across runs.
      aggregationTemporalitySelector: () => AggregationTemporality.DELTA,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }) }),
    ],
  });
  sdk.start();

  let stopped = false;
  return {
    // Best-effort: a collector blip during the final flush must never fail
    // the app (batch runs exit non-zero otherwise). The exporters already
    // retried in the background; this is the last-chance flush.
    shutdown: async () => {
      if (stopped) return;
      stopped = true;
      try {
        await sdk.shutdown();
      } catch (err) {
        console.error("telemetry flush failed (continuing):", err);
      }
    },
  };
}

export function tracer(): Tracer {
  return trace.getTracer("bidwatch");
}

export function meter(): Meter {
  return metrics.getMeter("bidwatch");
}

/**
 * Runs `fn` inside an active span so nested withSpan/startActiveSpan calls
 * attach as children. Errors are recorded and rethrown; outcome stays with
 * the span. This is the only span helper adapters need.
 */
export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    span.setAttributes(attrs);
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Liveness counter for daemon modes (cron feeder, polling worker): a stuck or
 * dead process stops incrementing `bidwatch.heartbeat`, and the Grafana
 * no-data alert fires. Timer is unref'd so it never holds the process open.
 */
export function startHeartbeat(intervalMs = 60_000): void {
  const heartbeat = meter().createCounter("bidwatch.heartbeat");
  const timer = setInterval(() => heartbeat.add(1), intervalMs);
  timer.unref();
}
