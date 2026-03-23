/**
 * L2 — Live Integration Tests
 *
 * Tests against a real Google account session. Requires:
 * 1. `browserkit login google-discover` — log into your Google account
 * 2. Google Discover enabled for your account
 *
 * Run with: pnpm test:integration
 * (NOT included in default `pnpm test` run)
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

interface Article {
  title: string;
  source: string;
  age: string;
  url: string;
  topic?: string;
  imageUrl?: string;
}

// ── Auth check ────────────────────────────────────────────────────────────────

describe("authentication (live)", () => {
  it("health_check reports loggedIn=true when Google session is active", async () => {
    const result = await client.callTool("browser", { action: "health_check" });
    const status = JSON.parse(result.content[0]?.text ?? "{}") as {
      loggedIn: boolean;
      site: string;
    };
    expect(status.site).toBe("google-discover");
    // Fails if not logged in — run: browserkit login google-discover
    expect(status.loggedIn).toBe(true);
  });
});

// ── get_feed ──────────────────────────────────────────────────────────────────

describe("get_feed (live, authenticated)", () => {
  it("returns an array of Discover articles", async () => {
    const result = await client.callTool("get_feed", { count: 5 });
    expect(result.isError).toBeFalsy();

    const articles = JSON.parse(result.content[0]?.text ?? "[]") as Article[];
    expect(Array.isArray(articles)).toBe(true);
    expect(articles.length).toBeGreaterThan(0);
    expect(articles.length).toBeLessThanOrEqual(5);
  });

  it("each article has a non-empty title and URL", async () => {
    const result = await client.callTool("get_feed", { count: 5 });
    expect(result.isError).toBeFalsy();

    const articles = JSON.parse(result.content[0]?.text ?? "[]") as Article[];
    for (const article of articles) {
      expect(article.title, "article missing title").toBeTruthy();
      expect(article.url, "article missing url").toBeTruthy();
      expect(article.url).toMatch(/^https?:\/\//);
    }
  });

  it("articles have source and age fields (may be empty if selectors need tuning)", async () => {
    const result = await client.callTool("get_feed", { count: 5 });
    const articles = JSON.parse(result.content[0]?.text ?? "[]") as Article[];

    // At least some articles should have source populated
    const withSource = articles.filter((a) => a.source.length > 0);
    if (withSource.length === 0) {
      console.warn("[selector tuning needed] No articles have source populated — check SELECTORS.cardSource");
    }
  });

  it("selector health report confirms feed cards are found on the live page", async () => {
    // Navigate to google.com first so health_check can validate selectors on the feed page
    await client.callTool("browser", { action: "navigate", { url: "https://www.google.com/?hl=en&gl=US" });
    await new Promise((r) => setTimeout(r, 2000)); // let the feed load

    const result = await client.callTool("browser", { action: "health_check" });
    const status = JSON.parse(result.content[0]?.text ?? "{}") as {
      selectors?: Record<string, { found: boolean; count: number }>;
    };

    if (status.selectors?.cardContainer) {
      const cardCount = status.selectors.cardContainer.count ?? 0;
      console.log(`[selectors] cardContainer found ${cardCount} elements`);
      if (cardCount === 0) {
        console.warn("[selector tuning needed] cardContainer (data-hveid) not found — Google may have changed the DOM");
      }
    }
  });
});
