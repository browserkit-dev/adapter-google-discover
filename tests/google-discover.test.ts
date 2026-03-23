import { describe, it, expect } from "vitest";
import adapter from "../src/index.js";

describe("Google Discover adapter", () => {
  it("has correct metadata", () => {
    expect(adapter.site).toBe("google-discover");
    expect(adapter.domain).toBe("google.com");
    expect(adapter.loginUrl).toContain("google.com");
  });

  it("exports selectors for health_check reporting", () => {
    expect(adapter.selectors).toBeDefined();
    expect(typeof adapter.selectors?.cardContainer).toBe("string");
    expect(typeof adapter.selectors?.cardTitle).toBe("string");
    expect(typeof adapter.selectors?.accountAvatar).toBe("string");
  });

  it("has rate limit configured", () => {
    expect(adapter.rateLimit?.minDelayMs).toBeGreaterThan(0);
  });

  it("exposes get_feed tool", () => {
    const tools = adapter.tools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_feed");
  });

  it("get_feed schema accepts valid count", () => {
    const tool = adapter.tools().find((t) => t.name === "get_feed")!;
    expect(tool.inputSchema.safeParse({ count: 10 }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ count: 1 }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ count: 15 }).success).toBe(true);
  });

  it("get_feed schema rejects count=0", () => {
    const tool = adapter.tools().find((t) => t.name === "get_feed")!;
    expect(tool.inputSchema.safeParse({ count: 0 }).success).toBe(false);
  });

  it("get_feed schema rejects count=16 (above max of 15)", () => {
    const tool = adapter.tools().find((t) => t.name === "get_feed")!;
    expect(tool.inputSchema.safeParse({ count: 16 }).success).toBe(false);
  });

  it("get_feed schema uses default count of 10", () => {
    const tool = adapter.tools().find((t) => t.name === "get_feed")!;
    const result = tool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(10);
    }
  });

  it("get_feed tool has a description mentioning login requirement", () => {
    const tool = adapter.tools().find((t) => t.name === "get_feed")!;
    expect(tool.description).toContain("login");
  });
});
