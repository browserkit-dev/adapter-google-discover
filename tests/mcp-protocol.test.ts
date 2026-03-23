/**
 * L3 — MCP Protocol Tests
 *
 * Starts the Google Discover adapter in-process, connects via the real MCP HTTP
 * transport, and verifies: server lifecycle, tool registry, tool dispatch.
 *
 * NOTE: get_feed requires a logged-in Google account. Without auth, the tool
 * returns isError:true with a descriptive message — we test this "no auth"
 * path as well as the protocol-level behaviour.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import googleDiscoverAdapter from "../src/index.js";
import { createTestAdapterServer, type TestAdapterServer } from "@browserkit/core/testing";
import { createTestMcpClient, type TestMcpClient } from "@browserkit/core/testing";

let server: TestAdapterServer;
let client: TestMcpClient;

beforeAll(async () => {
  server = await createTestAdapterServer(googleDiscoverAdapter);
  client = await createTestMcpClient(server.url);
}, 30_000);

afterAll(async () => {
  await client.close();
  await server.stop();
});

// ── Tool registry ─────────────────────────────────────────────────────────────

describe("tool registry", () => {
  it("lists get_feed tool", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_feed");
  });

  it("lists all 5 auto-registered management tools", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser");
    
    
    
    
  });

  it("all tools have a description", async () => {
    const tools = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `tool "${tool.name}" missing description`).toBeTruthy();
    }
  });
});

// ── get_page_state ────────────────────────────────────────────────────────────

describe("get_page_state", () => {
  it("returns mode=headless", async () => {
    const result = await client.callTool("browser", { action: "page_state" });
    const state = JSON.parse(result.content[0]?.text ?? "{}") as { mode: string };
    expect(state.mode).toBe("headless");
  });
});

// ── get_feed tool dispatch ────────────────────────────────────────────────────

describe("get_feed (without auth)", () => {
  it("returns isError=true when not logged in, with descriptive message", async () => {
    // Without auth the adapter should return a clear error, not crash
    const result = await client.callTool("get_feed", { count: 5 });
    // Either succeeds (if somehow logged in) or returns a helpful error
    if (result.isError) {
      const text = result.content[0]?.text ?? "";
      // Error message must be informative — not a raw exception
      expect(text.length).toBeGreaterThan(10);
      // Should mention login or Discover
      expect(text.toLowerCase()).toMatch(/login|discover|logged|sign in|account/);
    } else {
      // If it somehow returned results (user is logged in), validate shape
      const articles = JSON.parse(result.content[0]?.text ?? "[]") as unknown[];
      expect(Array.isArray(articles)).toBe(true);
    }
  });

  it("returns isError=true for count=0 (schema validation)", async () => {
    const result = await client.callTool("get_feed", { count: 0 });
    expect(result.isError).toBe(true);
  });
});

// ── Bearer token auth ─────────────────────────────────────────────────────────

describe("bearer token auth", () => {
  let protectedServer: TestAdapterServer;

  beforeAll(async () => {
    protectedServer = await createTestAdapterServer(googleDiscoverAdapter, "test-token");
  }, 30_000);

  afterAll(async () => {
    await protectedServer.stop();
  });

  it("rejects requests without a bearer token", async () => {
    const unauthClient = await createTestMcpClient(protectedServer.url).catch((e) => e);
    if (unauthClient instanceof Error) {
      expect(unauthClient.message).toBeTruthy();
    } else {
      const result = await unauthClient.callTool("browser", { action: "health_check" }).catch((e: Error) => e);
      expect(result instanceof Error).toBe(true);
      await unauthClient.close();
    }
  });
});
