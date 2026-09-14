import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { ResultStore } from "../../domain/ports.js";
import { withSpan } from "../../telemetry.js";

export interface S3StoreOptions {
  endpoint?: string;
  region?: string;
  /** MinIO needs path-style addressing; real AWS defaults to virtual-host. */
  forcePathStyle?: boolean;
}

/** S3 object store speaking the same protocol against AWS or MinIO. */
export class S3ResultStore implements ResultStore {
  private readonly client: S3Client;

  constructor(options: S3StoreOptions = {}) {
    const config: S3ClientConfig = { region: options.region ?? "us-east-1" };
    if (options.endpoint) {
      config.endpoint = options.endpoint;
      config.forcePathStyle = options.forcePathStyle ?? true;
    }
    this.client = new S3Client(config);
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await withSpan(
      "store.put",
      { bucket: this.bucketOf(key), key: this.keyOf(key), bytes: body.byteLength, content_type: contentType },
      async () => {
        await this.client.send(
          new PutObjectCommand({ Bucket: this.bucketOf(key), Key: this.keyOf(key), Body: body, ContentType: contentType }),
        );
      },
    );
  }

  async putText(key: string, text: string, contentType = "text/plain; charset=utf-8"): Promise<void> {
    await this.putObject(key, Buffer.from(text, "utf8"), contentType);
  }

  async putGzip(key: string, text: string): Promise<void> {
    await this.putObject(key, gzipSync(Buffer.from(text, "utf8")), "application/gzip");
  }

  /** Keys are written as "<bucket>/<key>" by callers; split here so ports stay bucket-agnostic. */
  private bucketOf(key: string): string {
    return key.split("/")[0] ?? "";
  }

  private keyOf(key: string): string {
    return key.split("/").slice(1).join("/");
  }
}
