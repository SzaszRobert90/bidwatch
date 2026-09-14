import { afterEach, describe, expect, it } from "vitest";
import { otlpEndpoint, startTelemetry, telemetryEnabled, withSpan } from "../src/telemetry.js";

const original = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

afterEach(() => {
  if (original === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = original;
});

describe("telemetry", () => {
  it("is off by default and its shutdown is a harmless no-op", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(telemetryEnabled()).toBe(false);
    const tel = startTelemetry("bidwatch-test");
    await expect(tel.shutdown()).resolves.toBeUndefined();
  });

  it("strips trailing slashes from the endpoint", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-lgtm:4318/";
    expect(otlpEndpoint()).toBe("http://otel-lgtm:4318");
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "  http://localhost:4318  ";
    expect(otlpEndpoint()).toBe("http://localhost:4318");
  });

  it("withSpan passes values through and rethrows errors when off", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    await expect(withSpan("x", {}, async () => 42)).resolves.toBe(42);
    await expect(withSpan("x", {}, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
  });
});
