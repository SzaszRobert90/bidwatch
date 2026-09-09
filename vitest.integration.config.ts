import { defineConfig } from "vitest/config";

/** Integration tests need ElasticMQ + MinIO: run via `npm run test:integration` with infra/test-env loaded. */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
