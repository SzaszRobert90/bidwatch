import { readFileSync } from "node:fs";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { SignatureDb } from "./domain/types.js";

export type { SignatureDb };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envSchema = z.object({
  /** "live" fetches Bing; "fixture" replays committed fixture HTML (dev/CI). */
  BIDWATCH_MODE: z.enum(["live", "fixture"]).default("live"),
  /** Live SERP adapter: playwright (real browser, ads are JS-injected) or http (probes only). */
  BIDWATCH_SERP_ADAPTER: z.enum(["playwright", "http"]).default("playwright"),
  /** Playwright browser channel: "chrome"/"msedge" (required for ad visibility) or empty for bundled chromium. */
  BIDWATCH_BROWSER_CHANNEL: z.string().default("chrome"),
  /** Headless sessions get no Bing ads; run headful under xvfb on servers. */
  BIDWATCH_HEADLESS: z.string().default("false"),
  /** Persistent browser profile dir — must survive between runs (volume in docker). */
  BIDWATCH_PROFILE_DIR: z.string().default(path.join(repoRoot, ".profile-bing")),
  /** curl-impersonate binary for landing fetches (browser TLS fingerprint); undici fallback when unset. */
  BIDWATCH_CURL_IMPERSONATE: z.string().default(""),
  BIDWATCH_FIXTURES_DIR: z.string().default(path.join(repoRoot, "fixtures")),
  /** Where to read brands.yaml / signatures.yaml. */
  BIDWATCH_CONFIG_DIR: z.string().default(path.join(repoRoot, "config")),

  BIDWATCH_RAW_BUCKET: z.string().default("bidwatch-raw"),
  BIDWATCH_CURATED_BUCKET: z.string().default("bidwatch-curated"),
  BIDWATCH_REPORTS_BUCKET: z.string().default("bidwatch-reports"),
  BIDWATCH_QUEUE_URL: z.string().default(""),
  BIDWATCH_DLQ_URL: z.string().default(""),
  /** aws sdk region; harmless for elasticmq/minio. */
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().default("local"),
  AWS_SECRET_ACCESS_KEY: z.string().default("local"),
  /** Comma-separated http proxy urls for polite egress rotation. Empty = direct. */
  BIDWATCH_PROXIES: z.string().default(""),
  /** Delay between landing fetches within one run, ms. */
  BIDWATCH_POLITENESS_MS: z.coerce.number().int().min(0).default(500),
  /** Max third-party ads to inspect per SERP. */
  BIDWATCH_MAX_LANDINGS: z.coerce.number().int().min(1).max(20).default(8),
  /** Worker: exit when queue drains instead of polling forever. */
  BIDWATCH_WORKER_ONCE: z.string().default(""),
  /** Feeder cron expression (node-cron), used when not run with --once. */
  BIDWATCH_FEEDER_CRON: z.string().default("0 6 * * *"),
  /** DuckDB/httpfs settings for the report app. */
  BIDWATCH_S3_ENDPOINT: z.string().default(""),
  BIDWATCH_S3_USE_SSL: z.string().default("true"),
  /** OTLP collector base URL (compose: http://otel-lgtm:4318; host e2e: http://localhost:4318). Empty = telemetry off. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  return envSchema.parse({ ...process.env, ...stripUndefined(overrides) });
}

const brandSchema = z.object({
  key: z.string().min(2),
  domain: z.string().min(3),
  geo: z.string().default("us"),
  keywords: z.array(z.string()).default([]),
});

const paramSchema = z.object({
  name: z.string().min(1),
  valuePattern: z.string().optional(),
});

const networkSchema = z.object({
  network: z.string().min(1),
  params: z.array(paramSchema).default([]),
  valuePatterns: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  disclosure: z.array(z.string()).default([]),
});

export interface BrandConfig {
  key: string;
  domain: string;
  geo: string;
  keywords: string[];
}

export function loadBrands(env: Env): BrandConfig[] {
  const raw = readFileSync(path.join(env.BIDWATCH_CONFIG_DIR, "brands.yaml"), "utf8");
  return z.object({ brands: z.array(brandSchema) }).parse(parseYaml(raw)).brands;
}

export function loadSignatures(env: Env): SignatureDb {
  const raw = readFileSync(path.join(env.BIDWATCH_CONFIG_DIR, "signatures.yaml"), "utf8");
  return z.object({ networks: z.array(networkSchema) }).parse(parseYaml(raw)) as SignatureDb;
}

function stripUndefined(obj: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}
