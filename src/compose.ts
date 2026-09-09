import { BingHttpProvider } from "./adapters/bing/bing-http.js";
import { BingPlaywrightProvider } from "./adapters/bing/bing-playwright.js";
import { HttpLandingInspector } from "./adapters/landing/inspector.js";
import { createCurlImpersonateTransport } from "./adapters/landing/curl-impersonate.js";
import { FixtureLandingInspector, FixtureSerpProvider } from "./adapters/fixture/fixture.js";
import { SqsJobQueue } from "./adapters/queue/sqs.js";
import { S3ResultStore } from "./adapters/store/s3.js";
import { loadSignatures } from "./config.js";
import type { Env } from "./config.js";
import type { JobQueue, LandingInspector, ResultStore, SerpProvider } from "./domain/ports.js";
import pino from "pino";

export interface Wiring {
  provider: SerpProvider;
  inspector: LandingInspector;
  queue: JobQueue;
  store: ResultStore;
  log: pino.Logger;
}

export function wire(env: Env): Wiring {
  const log = pino({ level: process.env.BIDWATCH_LOG_LEVEL ?? "info" });
  const signatures = loadSignatures(env);

  const provider: SerpProvider =
    env.BIDWATCH_MODE === "fixture"
      ? new FixtureSerpProvider(env.BIDWATCH_FIXTURES_DIR)
      : env.BIDWATCH_SERP_ADAPTER === "http"
        ? new BingHttpProvider({ proxies: splitList(env.BIDWATCH_PROXIES) })
        : new BingPlaywrightProvider({
            channel: env.BIDWATCH_BROWSER_CHANNEL || undefined,
            headless: env.BIDWATCH_HEADLESS !== "true",
            profileDir: env.BIDWATCH_PROFILE_DIR,
          });

  const transport =
    env.BIDWATCH_CURL_IMPERSONATE !== ""
      ? createCurlImpersonateTransport({
          binary: env.BIDWATCH_CURL_IMPERSONATE,
          proxies: splitList(env.BIDWATCH_PROXIES),
        })
      : undefined;

  const inspector: LandingInspector =
    env.BIDWATCH_MODE === "fixture"
      ? new FixtureLandingInspector(signatures, env.BIDWATCH_FIXTURES_DIR)
      : new HttpLandingInspector({
          signatures,
          transport,
          proxies: splitList(env.BIDWATCH_PROXIES),
        });

  const queue = new SqsJobQueue({
    queueUrl: env.BIDWATCH_QUEUE_URL,
    dlqUrl: env.BIDWATCH_DLQ_URL,
    endpoint: process.env.BIDWATCH_SQS_ENDPOINT || undefined,
  });

  const store = new S3ResultStore({
    endpoint: env.BIDWATCH_S3_ENDPOINT || undefined,
    forcePathStyle: env.BIDWATCH_S3_ENDPOINT !== "",
  });

  return { provider, inspector, queue, store, log };
}

function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
