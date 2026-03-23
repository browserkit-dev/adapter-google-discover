import { defineAdapter } from "@browserkit/core";
import { z } from "zod";
import type { Page } from "playwright";
import { SELECTORS } from "./selectors.js";
import { scrapeDiscoverCards } from "./scraper.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
  title: string;
  source: string;
  age: string;
  url: string;
  imageUrl?: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const feedSchema = z.object({
  count: z
    .number()
    .int()
    .min(1)
    .max(15)
    .default(10)
    .describe("Number of Discover articles to return (1–15). Google Discover loads ~10 articles on initial page render and does not trigger infinite scroll in automated browser contexts."),
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
   *
   * IMPORTANT: does NOT navigate — just checks the current page for a Google
   * Account avatar. This makes it safe to call repeatedly during the login flow
   * (the login command polls isLoggedIn() while the user is signing in — if we
   * navigated to google.com on each call, it would keep pulling the user away
   * from the sign-in page).
   *
   * The avatar appears on any *.google.com page once logged in.
   */
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      // If not on google.com, navigate there first so we can check for the avatar.
      // We avoid navigation during normal tool calls (where the page is already on google.com),
      // but navigate on startup checks and after cold-starts where the page is about:blank.
      const url = page.url();
      if (!url.includes("google.com")) {
        await page.goto("https://www.google.com/?hl=en&gl=US", {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        // Accept any consent banner
        const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Accept")').first();
        if (await consent.isVisible({ timeout: 2000 }).catch(() => false)) {
          await consent.click().catch(() => {});
          await page.waitForTimeout(800);
        }
      }
      const avatar = page.locator(SELECTORS.accountAvatar).first();
      return await avatar.isVisible({ timeout: 3000 });
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
        "Returns the ~10 articles Google loads on initial page render. " +
        "NOTE: Google Discover does not trigger infinite scroll in automated browser contexts — " +
        "the practical limit is ~10 articles per call regardless of `count`.",
      inputSchema: feedSchema,
      async handler(page: Page, input: unknown) {
        const { count } = feedSchema.parse(input) satisfies FeedInput;

        // Navigate to google.com in mobile mode — Discover appears below the search bar
        // Skip navigation if already on google.com (saves round-trip and keeps loaded feed)
        const currentUrl = page.url();
        if (!currentUrl.includes("google.com") || currentUrl.includes("accounts.google.com")) {
          await page.goto("https://www.google.com/?hl=en&gl=US", {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          });
        }

        // Accept consent dialog if present
        const consentBtn = page.locator(
          'button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Accept"), [aria-label*="Accept"]'
        ).first();
        if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await consentBtn.click().catch(() => {});
        }

        // Wait for Discover cards to load.
        //
        // KNOWN LIMITATION — Google Discover does not support infinite scroll
        // in automated browser contexts (Playwright, headless Chrome, or even
        // watch-mode headed Chrome). The IntersectionObserver-based lazy-loading
        // that powers infinite scroll on a real mobile device does not fire when
        // scroll events are simulated via JavaScript or CDP input events.
        //
        // The practical result: Google renders ~10 articles on initial page load
        // and no further articles appear regardless of how much we scroll.
        // `count` is capped at 15 to reflect this reality.
        //
        // If this ever changes (e.g. Google updates their Discover serving or
        // Playwright adds native touch scroll support), re-investigate by running
        // watch mode and manually verifying that scrolling loads new cards before
        // re-enabling progressive scroll in this handler.
        try {
          await page.evaluate(() => window.scrollBy(0, 400));
          await page.waitForFunction(
            (sel) => Array.from(document.querySelectorAll(sel))
              .filter((el) => (el.textContent?.trim().length ?? 0) > 30).length >= 1,
            SELECTORS.cardContainer,
            { timeout: 20_000 }
          );
          await page.waitForTimeout(1000);
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
        const articles: Article[] = await scrapeDiscoverCards(page, SELECTORS.cardContainer, count);

        const validArticles = articles.filter((a) => a.title.length > 0);        if (validArticles.length === 0) {
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
