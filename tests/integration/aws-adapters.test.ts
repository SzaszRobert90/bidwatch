import { describe, expect, it } from "vitest";
import { SqsJobQueue } from "../../src/adapters/queue/sqs.js";
import { S3ResultStore } from "../../src/adapters/store/s3.js";
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
});
