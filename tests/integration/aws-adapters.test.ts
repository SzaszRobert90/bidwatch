import { describe, expect, it } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";
import { SqsJobQueue } from "../../src/adapters/queue/sqs.js";
import { S3ResultStore } from "../../src/adapters/store/s3.js";
import { applyS3Settings } from "../../src/duckdb/settings.js";
import { runTransform } from "../../src/duckdb/transform.js";
import type { SerpQuery } from "../../src/domain/types.js";

/**
 * Integration tests against ElasticMQ + MinIO.
 * Run with infra running: `docker compose -f infra/compose.yml up -d minio elasticmq`
 * then `BIDWATCH_IT=1 npm run test:integration` (endpoints default to localhost).
 */
const enabled = process.env.BIDWATCH_IT === "1";

const job: SerpQuery = {
  runId: `run_it_${Date.now().toString(36)}`,
  brand: "nordvpn",
  brandDomain: "nordvpn.com",
  keyword: "nordvpn coupon",
  geo: "us",
  engine: "bing",
  enqueuedAt: new Date().toISOString(),
};

describe.skipIf(!enabled)("aws adapters", () => {
  const sqsEndpoint = process.env.BIDWATCH_SQS_ENDPOINT ?? "http://localhost:9324";
  const s3Endpoint = process.env.BIDWATCH_S3_ENDPOINT ?? "http://localhost:9000";
  const queueUrl = `${sqsEndpoint}/queue/bidwatch-it`;
  const dlqUrl = `${sqsEndpoint}/queue/bidwatch-it-dlq`;

  it("ensures queues, sends, receives, deletes a job", async () => {
    const queue = new SqsJobQueue({ queueUrl, dlqUrl, endpoint: sqsEndpoint });
    await queue.ensureQueues();
    await queue.send(job);

    const received = await queue.receive(10, 1);
    expect(received.length).toBeGreaterThan(0);
    const msg = received.find((m) => m.job.runId === job.runId);
    expect(msg?.job.keyword).toBe("nordvpn coupon");
    if (msg) await queue.remove(msg.handle);

    const again = await queue.receive(10, 1);
    expect(again.find((m) => m.job.runId === job.runId)).toBeUndefined();
  });

  it("counts messages", async () => {
    const queue = new SqsJobQueue({ queueUrl, dlqUrl, endpoint: sqsEndpoint });
    const count = await queue.approximateCount();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("writes objects to MinIO with path-style addressing", async () => {
    const store = new S3ResultStore({ endpoint: s3Endpoint, forcePathStyle: true });
    await store.putText(
      "bidwatch-curated/curated/observations/dt=1970-01-01/run=it-test.jsonl",
      '{"smoke": true}\n',
      "application/x-ndjson",
    );
    await store.putGzip("bidwatch-raw/raw/engine=bing/dt=1970-01-01/run=it-test/serp.html.gz", "<html>gzipped</html>");
  });

  it("transforms bronze into gold parquet in MinIO", async () => {
    const store = new S3ResultStore({ endpoint: s3Endpoint, forcePathStyle: true });
    const dt = "1970-01-02";
    const runId = `run_it_${Date.now().toString(36)}`;
    const meta = {
      query: { runId, brand: "nike", brandDomain: "nike.com", keyword: "it keyword", geo: "us", engine: "bing", enqueuedAt: `${dt}T05:00:00.000Z` },
      fetchedAt: `${dt}T06:00:11.000Z`,
      finalUrl: "https://www.bing.com/search?q=it",
      notice: null,
      adCount: 1,
    };
    await store.putText(`bidwatch-raw/raw/engine=bing/dt=${dt}/run=${runId}/meta.json`, JSON.stringify(meta, null, 2), "application/json");
    const obsRow = { runId, brand: "nike", brandDomain: "nike.com", keyword: "it keyword", geo: "us", engine: "bing", fetchedAt: `${dt}T06:00:11.000Z`, adIndex: 0, title: "Ad", displayUrl: "reseller.io/x", displayDomain: "reseller.io", clickUrl: "https://www.bing.com/aclick?u=0", classification: "unknown", inspected: false };
    await store.putText(`bidwatch-curated/curated/observations/dt=${dt}/run=${runId}.jsonl`, JSON.stringify(obsRow) + "\n", "application/x-ndjson");

    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    await conn.run("INSTALL httpfs; LOAD httpfs;");
    await applyS3Settings(conn, { BIDWATCH_S3_ENDPOINT: s3Endpoint, BIDWATCH_S3_USE_SSL: "false", AWS_REGION: "us-east-1" });
    const files = await runTransform(conn, { rawLake: "s3://bidwatch-raw", curatedLake: "s3://bidwatch-curated" });
    expect(files.length).toBeGreaterThan(0);

    const gold = await conn.runAndReadAll(
      `SELECT count(*) AS n FROM read_parquet('s3://bidwatch-curated/gold/daily_brand_keyword/**/*.parquet', hive_partitioning=true) WHERE dt = DATE '${dt}'`,
    );
    const rows = gold.getRowObjectsJson();
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
