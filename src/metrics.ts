import type { Counter, Histogram } from "@opentelemetry/api";
import { meter } from "./telemetry.js";

/**
 * The bidwatch business metrics, created lazily exactly once per process.
 * Naming maps to Prometheus as `bidwatch_<name_underscores>` (counters gain
 * `_total`, `.duration` with unit "s" gains `_seconds`). Low-cardinality
 * attributes only: mode/app/outcome/brand — never keyword or URL.
 */
export interface BidwatchMetrics {
  /** Worker: one increment per queue job, outcome=ok|error. */
  jobs: Counter;
  /** Worker: violations found per job (added, not incremented per-row). */
  violations: Counter;
  /** Worker: ads observed per SERP, so "zero ads all day" is alertable. */
  ads: Counter;
  /** Worker: SERP fetch duration in seconds (fixture and live alike). */
  serpDuration: Histogram;
  /** Worker: redirect hops per landing inspection. */
  landingHops: Histogram;
  /** Worker: landing inspections that ended in a transport error. */
  landingErrors: Counter;
  /** Feeder/transform/report: one increment per successful run. */
  runComplete: Counter;
}

let cache: BidwatchMetrics | null = null;

export function bidwatchMetrics(): BidwatchMetrics {
  if (cache === null) {
    const m = meter();
    cache = {
      jobs: m.createCounter("bidwatch.jobs"),
      violations: m.createCounter("bidwatch.violations"),
      ads: m.createCounter("bidwatch.ads"),
      serpDuration: m.createHistogram("bidwatch.serp.duration", {
        unit: "s",
        advice: { explicitBucketBoundaries: [0.5, 1, 2, 5, 10, 20, 40] },
      }),
      landingHops: m.createHistogram("bidwatch.landing.hops", {
        advice: { explicitBucketBoundaries: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      }),
      landingErrors: m.createCounter("bidwatch.landing.errors"),
      runComplete: m.createCounter("bidwatch.run.complete"),
    };
  }
  return cache;
}
