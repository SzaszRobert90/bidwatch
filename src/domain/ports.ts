import type { LandingInspection, SerpFetch, SerpQuery } from "./types.js";

export interface SerpProvider {
  fetchSerp(query: SerpQuery): Promise<SerpFetch>;
  /** Release engine resources (e.g. a headless browser). Optional. */
  dispose?(): Promise<void>;
}

export interface LandingInspector {
  inspect(url: string): Promise<LandingInspection>;
}

export interface QueueMessage {
  handle: string;
  job: SerpQuery;
}

export interface JobQueue {
  /** Idempotently create the main queue + DLQ with a redrive policy. */
  ensureQueues(): Promise<void>;
  send(job: SerpQuery): Promise<void>;
  receive(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]>;
  remove(handle: string): Promise<void>;
  approximateCount(): Promise<number>;
  queueUrl(): string;
}

export interface ResultStore {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  putText(key: string, text: string, contentType: string): Promise<void>;
  putGzip(key: string, text: string): Promise<void>;
}
