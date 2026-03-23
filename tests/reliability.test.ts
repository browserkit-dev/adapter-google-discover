/**
 * L4 — Reliability Tests
 *
 * Tests concurrency (LockManager serialises parallel calls), latency,
 * and error recovery. Uses the unauthenticated path for concurrency/latency
 * (faster than real navigation) and validates server stays healthy after errors.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import googleDiscoverAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit/core/testing";
import { createTestMcpClient } from "@browserkit/core/testing";

let server: TestAdapterServer;

beforeAll(async () => {
  server = await createTestAdapterServer(googleDiscoverAdapter);
}, 30_000);

afterAll(async () => {
  await server.stop();
});

// ── Concurrency ───────────────────────────────────────────────────────────────

describe("concurrency", () => {
  it("serialises parallel get_feed calls — all complete without race conditions", async () => {
    const NUM = 3;
    const clients = await Promise.all(
      Array.from({ length: NUM }, () => createTestMcpClient(server.url))
    );

    const results = await Promise.all(
      clients.map((c) => c.callTool("get_feed", { count: 1 }))
    );

    // All must complete (either success or structured error — not crash)
    for (const result of results) {
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]?.type).toBe("text");
    }

    expect(results).toHaveLength(NUM);
    await Promise.all(clients.map((c) => c.close()));
  }, 90_000);

  it("concurrent health_check calls all succeed", async () => {
    const NUM = 5;
    const clients = await Promise.all(
      Array.from({ length: NUM }, () => createTestMcpClient(server.url))
    );

    const results = await Promise.all(
      clients.map((c) => c.callTool("health_check"))
    );

    for (const result of results) {
      const status = JSON.parse(result.content[0]?.text ?? "{}") as { site: string };
      expect(status.site).toBe("google-discover");
    }

    await Promise.all(clients.map((c) => c.close()));
  }, 30_000);
});

// ── Latency ───────────────────────────────────────────────────────────────────

describe("latency", () => {
  it("health_check responds under 10s", async () => {
    const client = await createTestMcpClient(server.url);
    const t0 = Date.now();
    const result = await client.callTool("health_check");
    const elapsed = Date.now() - t0;

    expect(result.isError).toBeFalsy();
    expect(elapsed).toBeLessThan(10_000);
    await client.close();
  }, 15_000);
});

// ── Error recovery ────────────────────────────────────────────────────────────

describe("error recovery", () => {
  it("server stays healthy after schema-rejected call", async () => {
    const client = await createTestMcpClient(server.url);

    const bad = await client.callTool("get_feed", { count: 0 });
    expect(bad.isError).toBe(true);

    const good = await client.callTool("health_check");
    const status = JSON.parse(good.content[0]?.text ?? "{}") as { site: string };
    expect(status.site).toBe("google-discover");

    await client.close();
  }, 30_000);

  it("multiple rapid sequential calls do not leave the lock held", async () => {
    const client = await createTestMcpClient(server.url);

    for (let i = 0; i < 5; i++) {
      const result = await client.callTool("health_check");
      expect(result.content[0]?.type).toBe("text");
    }

    await client.close();
  }, 60_000);
});
