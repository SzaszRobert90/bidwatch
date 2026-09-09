import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
  type SQSClientConfig,
} from "@aws-sdk/client-sqs";
import { z } from "zod";
import type { JobQueue, QueueMessage } from "../../domain/ports.js";
import type { SerpQuery } from "../../domain/types.js";

const jobSchema = z.object({
  runId: z.string(),
  brand: z.string(),
  brandDomain: z.string(),
  keyword: z.string(),
  geo: z.string(),
  engine: z.enum(["bing"]),
  enqueuedAt: z.string(),
});

export interface SqsQueueOptions {
  queueUrl: string;
  dlqUrl: string;
  endpoint?: string;
  region?: string;
  /** Redrive: messages die to the DLQ after this many receives. */
  maxReceiveCount?: number;
}

/** SQS queue speaking the same protocol against AWS or ElasticMQ. */
export class SqsJobQueue implements JobQueue {
  private readonly client: SQSClient;
  private readonly mainQueueUrl: string;
  private readonly dlqUrl: string;
  private readonly maxReceiveCount: number;

  constructor(options: SqsQueueOptions) {
    const config: SQSClientConfig = { region: options.region ?? "us-east-1" };
    if (options.endpoint) config.endpoint = options.endpoint;
    this.client = new SQSClient(config);
    this.mainQueueUrl = options.queueUrl;
    this.dlqUrl = options.dlqUrl;
    this.maxReceiveCount = options.maxReceiveCount ?? 3;
  }

  queueUrl(): string {
    return this.mainQueueUrl;
  }

  async ensureQueues(): Promise<void> {
    await this.ensureWithRedrive(this.mainQueueUrl, this.dlqUrl);
    await this.ensureWithRedrive(this.dlqUrl, undefined);
  }

  private async ensureWithRedrive(url: string, dlqUrl: string | undefined): Promise<void> {
    const name = queueNameOf(url);
    const attributes: Record<string, string> = { VisibilityTimeout: "300" };
    if (dlqUrl !== undefined && dlqUrl.length > 0) {
      const dlqArn = await this.arnOf(dlqUrl);
      if (dlqArn !== null) {
        attributes.RedrivePolicy = JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: this.maxReceiveCount,
        });
      }
    }
    try {
      await this.client.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }));
      // Queue exists; real SQS rejects CreateQueue with differing attributes, so use Set.
      await this.client.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: attributes }));
    } catch {
      await this.client.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
    }
  }

  private async arnOf(url: string): Promise<string | null> {
    try {
      const res = await this.client.send(
        new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
      );
      return res.Attributes?.QueueArn ?? null;
    } catch {
      return null;
    }
  }

  async send(job: SerpQuery): Promise<void> {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.mainQueueUrl, MessageBody: JSON.stringify(job) }),
    );
  }

  async receive(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.mainQueueUrl,
        MaxNumberOfMessages: Math.min(maxMessages, 10),
        WaitTimeSeconds: Math.min(waitSeconds, 20),
      }),
    );
    const messages = res.Messages ?? [];
    const out: QueueMessage[] = [];
    for (const m of messages) {
      if (m.ReceiptHandle === undefined || m.Body === undefined) continue;
      const parsed = jobSchema.safeParse(JSON.parse(m.Body));
      if (!parsed.success) {
        console.error("dropping malformed queue message", parsed.error.message);
        continue;
      }
      out.push({ handle: m.ReceiptHandle, job: parsed.data });
    }
    return out;
  }

  async remove(handle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.mainQueueUrl, ReceiptHandle: handle }),
    );
  }

  async approximateCount(): Promise<number> {
    const res = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.mainQueueUrl,
        AttributeNames: ["ApproximateNumberOfMessages"],
      }),
    );
    return Number(res.Attributes?.ApproximateNumberOfMessages ?? "0");
  }
}

function queueNameOf(url: string): string {
  const path = url.split("/").pop() ?? "bidwatch-main";
  return path;
}
