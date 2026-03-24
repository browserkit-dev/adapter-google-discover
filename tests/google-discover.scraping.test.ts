/**
 * Mock DOM scraping tests for the Google Discover adapter.
 *
 * These tests validate the extraction heuristics in `src/scraper.ts` without
 * requiring a real Google account or internet access. They use:
 *
 *   1. A real headless Playwright browser (Pixel 5 emulation, same as production)
 *   2. A local HTML fixture that mirrors the real Google Discover DOM structure
 *      (data-hveid cards, leaf div/span titles, no a[href] on some cards)
 *
 * What's tested:
 *   - Title extraction (longest leaf text heuristic)
 *   - Source extraction (short text that isn't title or age)
 *   - Age extraction (text matching time-unit pattern)
 *   - URL extraction from a[href] and data-url attributes
 *   - Image URL extraction
 *   - Noise filtering (short-text cards, empty cards)
 *   - count parameter (returns at most N cards)
 *   - Unicode / non-ASCII titles
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "patchright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeDiscoverCards } from "../src/scraper.js";
import { SELECTORS } from "../src/selectors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "discover-mock.html");
const FIXTURE_URL = `file://${FIXTURE_PATH}`;

// ── Browser setup ─────────────────────────────────────────────────────────────

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  const pixel5 = devices["Pixel 5"];
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ ...pixel5 });
  page = await context.newPage();
  await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
}, 15_000);

afterAll(async () => {
  await context.close();
  await browser.close();
});

// ── Fixture sanity ────────────────────────────────────────────────────────────

describe("fixture sanity", () => {
  it("loads the mock page", async () => {
    expect(page.url()).toContain("discover-mock.html");
  });

  it("fixture contains the expected number of data-hveid elements", async () => {
    const count = await page.locator("[data-hveid]").count();
    expect(count).toBe(8); // 5 articles + 3 noise elements
  });
});

// ── scrapeDiscoverCards core behaviour ────────────────────────────────────────

describe("scrapeDiscoverCards", () => {
  it("returns only cards with substantial text (filters noise)", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 30);
    // 5 article cards, 3 noise cards should be filtered
    expect(articles.length).toBe(5);
  });

  it("respects the count limit", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 3);
    expect(articles.length).toBe(3);
  });

  it("count=1 returns exactly one article", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 1);
    expect(articles.length).toBe(1);
  });
});

// ── Title extraction ──────────────────────────────────────────────────────────

describe("title extraction", () => {
  it("extracts the article title as the longest leaf text in the card", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const titles = articles.map((a) => a.title);

    expect(titles).toContain(
      "Launching Cloudflare's Gen 13 servers: trading cache for cores for 2x edge compute performance"
    );
    expect(titles).toContain(
      "OpenAI announces GPT-5: a model that reasons across text, code, images, and video in real time"
    );
  });

  it("all returned articles have non-empty titles", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    for (const a of articles) {
      expect(a.title, `empty title in article: ${JSON.stringify(a)}`).toBeTruthy();
    }
  });

  it("handles Unicode / non-ASCII titles (Hebrew)", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const hebrewArticle = articles.find((a) => /[\u0590-\u05FF]/.test(a.title));
    expect(hebrewArticle, "should find the Hebrew article").toBeDefined();
    expect(hebrewArticle?.title).toContain("טיסות");
  });
});

// ── Source extraction ─────────────────────────────────────────────────────────

describe("source extraction", () => {
  it("extracts publisher name for card with clear source span", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const cloudflare = articles.find((a) => a.title.includes("Cloudflare"));
    expect(cloudflare?.source).toBe("Cloudflare Blog");
  });

  it("extracts source from card with jsaction (no a[href])", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const openai = articles.find((a) => a.title.includes("OpenAI"));
    expect(openai?.source).toBe("OpenAI");
  });

  it("extracts Ars Technica as source for card 5", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const rabbit = articles.find((a) => a.title.includes("Rabbit"));
    expect(rabbit?.source).toBe("Ars Technica");
  });
});

// ── Age extraction ────────────────────────────────────────────────────────────

describe("age extraction", () => {
  it("extracts relative age with hours", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const cloudflare = articles.find((a) => a.title.includes("Cloudflare"));
    expect(cloudflare?.age).toBe("4h ago");
  });

  it("extracts relative age in short format (h, d, w)", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    // Card 3: "1w"
    const ageValues = articles.map((a) => a.age).filter(Boolean);
    expect(ageValues.some((a) => /\d+[hdw]/.test(a))).toBe(true);
  });

  it("extracts 'yesterday' as age", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const rabbit = articles.find((a) => a.title.includes("Rabbit"));
    expect(rabbit?.age).toBe("yesterday");
  });
});

// ── URL extraction ────────────────────────────────────────────────────────────

describe("url extraction", () => {
  it("extracts URL from a[href] when present", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const cloudflare = articles.find((a) => a.title.includes("Cloudflare"));
    expect(cloudflare?.url).toBe("https://techcrunch.com/2026/03/23/cloudflare-gen13/");
  });

  it("extracts URL from data-url attribute when no a[href]", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const rabbit = articles.find((a) => a.title.includes("Rabbit"));
    expect(rabbit?.url).toBe("https://arstechnica.com/tech-policy/2026/03/rabbit-cyberdeck/");
  });

  it("returns empty string for cards with neither a[href] nor data-url", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const openai = articles.find((a) => a.title.includes("OpenAI"));
    // Card 2 has jsaction but no href or data-url
    expect(openai?.url).toBe("");
  });
});

// ── Image extraction ──────────────────────────────────────────────────────────

describe("image extraction", () => {
  it("extracts imageUrl when img[src] is present", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    const cloudflare = articles.find((a) => a.title.includes("Cloudflare"));
    expect(cloudflare?.imageUrl).toBe("https://img.example.com/cloudflare.jpg");
  });

  it("omits imageUrl when no image in card", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    // Card 4 (Hebrew article) has no image
    const hebrew = articles.find((a) => /[\u0590-\u05FF]/.test(a.title));
    expect(hebrew?.imageUrl).toBeUndefined();
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("does not include noise cards (text < 30 chars)", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 30);
    const adCard = articles.find((a) => a.title === "Ad" || a.title === "See more");
    expect(adCard).toBeUndefined();
  });

  it("does not include empty data-hveid elements", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 30);
    const emptyCard = articles.find((a) => a.title === "");
    expect(emptyCard).toBeUndefined();
  });

  it("title is never longer than 300 characters", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    for (const a of articles) {
      expect(a.title.length).toBeLessThanOrEqual(300);
    }
  });

  it("source is never longer than 60 characters", async () => {
    const articles = await scrapeDiscoverCards(page, SELECTORS.cardContainer, 5);
    for (const a of articles) {
      expect(a.source.length).toBeLessThanOrEqual(60);
    }
  });
});
