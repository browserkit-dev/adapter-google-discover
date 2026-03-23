import { defineAdapter } from "@browserkit/core";
import { z } from "zod";
import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
  title: string;
  source: string;
  age: string;
  url: string;
  topic?: string;
  imageUrl?: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const feedSchema = z.object({
  count: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10)
    .describe("Number of Discover articles to return (1–30)"),
});

type FeedInput = z.infer<typeof feedSchema>;

// ─── Adapter ──────────────────────────────────────────────────────────────────

export default defineAdapter({
  site: "google-discover",
  domain: "google.com",
  loginUrl: "https://accounts.google.com/ServiceLogin",
  selectors: SELECTORS,
  rateLimit: { minDelayMs: 3000 },

  /**
   * Returns true when the user is logged into Google.
   * Navigates to google.com and checks for a Google Account avatar in the
   * top-right corner — the canonical indicator of a logged-in Google session
   * on the mobile web interface.
   */
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      await page.goto("https://www.google.com/?hl=en&gl=US", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      // Accept any consent/cookie banner that may appear
      const consentBtn = page.locator(
        'button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Accept"), [aria-label*="Accept"]'
      ).first();
      if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await consentBtn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
      // Check for Google Account avatar (logged in) vs Sign in button (not logged in)
      const avatar = page.locator(SELECTORS.accountAvatar).first();
      const isLoggedIn = await avatar.isVisible({ timeout: 3000 });
      return isLoggedIn;
    } catch {
      return false;
    }
  },

  tools: () => [
    // ── get_feed ─────────────────────────────────────────────────────────────
    {
      name: "get_feed",
      description:
        "Get personalised articles from your Google Discover feed. " +
        "Requires a logged-in Google account (run `browserkit login google-discover` once). " +
        "The adapter runs in Pixel 5 mobile emulation so Google serves the full Discover feed. " +
        "Results are sorted by Google's personalisation algorithm based on your interests and activity.",
      inputSchema: feedSchema,
      async handler(page: Page, input: unknown) {
        const { count } = feedSchema.parse(input) satisfies FeedInput;

        // Navigate to google.com in mobile mode — Discover appears below the search bar
        await page.goto("https://www.google.com/?hl=en&gl=US", {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });

        // Accept consent dialog if present
        const consentBtn = page.locator(
          'button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Accept"), [aria-label*="Accept"]'
        ).first();
        if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await consentBtn.click().catch(() => {});
        }

        // Wait for Discover cards — they load after the page settles
        try {
          await page.waitForSelector(SELECTORS.cardContainer, { timeout: 10_000 });
        } catch {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: "Discover feed not found. Make sure you are logged in (`browserkit login google-discover`) and that Google Discover is enabled for your account.",
                hint: "Run health_check to see selector status.",
              }),
            }],
            isError: true,
          };
        }

        // Scroll down a bit to trigger lazy-loading of feed cards
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(1500);

        // Scrape all visible Discover cards in one page.evaluate pass
        const articles: Article[] = await page.evaluate(
          ({ containerSel, n }) => {
            const containers = Array.from(
              document.querySelectorAll(containerSel)
            ).filter((el) => {
              // Only cards that have a heading (title) and a link — excludes
              // tracking pixels and non-article elements that also have data-hveid
              const hasTitle = el.querySelector("h3, h4, [role='heading']");
              const hasLink = el.querySelector("a[href]");
              return hasTitle && hasLink;
            }).slice(0, n);

            return containers.map((card) => {
              const titleEl = card.querySelector("h3, h4, [role='heading']") as HTMLElement | null;
              const linkEl = card.querySelector("a[href]") as HTMLAnchorElement | null;
              const imgEl = card.querySelector("img[src]") as HTMLImageElement | null;

              // Source and age: look for small text nodes near the title.
              // Google renders them as spans in the card metadata area.
              // We grab ALL short text spans and classify them heuristically.
              const spans = Array.from(card.querySelectorAll("span, div"))
                .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
                .filter((t) => t.length > 0 && t.length < 100 && t !== (titleEl?.textContent ?? "").trim());

              // Age heuristic: contains time units
              const ageSpan = spans.find((t) =>
                /\b(ago|hour|min|day|week|yesterday|today|just now)\b/i.test(t)
              ) ?? "";

              // Source heuristic: short string that isn't the age or title,
              // typically a publication name
              const sourceSpan = spans.find((t) =>
                t !== ageSpan && t.length > 2 && t.length < 60 && !/^\d/.test(t)
              ) ?? "";

              // Topic label: sometimes rendered as a tag/pill on the card
              const topicEl = card.querySelector("[aria-label*='topic'], [aria-label*='interest'], .topic, .label") as HTMLElement | null;
              const topic = topicEl?.textContent?.trim() ?? undefined;

              return {
                title: titleEl?.textContent?.trim() ?? "",
                source: sourceSpan,
                age: ageSpan,
                url: linkEl?.href ?? "",
                ...(topic ? { topic } : {}),
                ...(imgEl?.src ? { imageUrl: imgEl.src } : {}),
              };
            });
          },
          { containerSel: SELECTORS.cardContainer, n: count }
        );

        const validArticles = articles.filter((a) => a.title.length > 0 && a.url.length > 0);

        if (validArticles.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: "No articles found in Discover feed.",
                hint: "Ensure you are logged in and Google Discover is enabled for your account. The selectors may need updating — run health_check to diagnose.",
              }),
            }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(validArticles, null, 2) }],
        };
      },
    },
  ],
});
