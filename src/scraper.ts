import type { Page } from "patchright";

export interface Article {
  title: string;
  source: string;
  age: string;
  url: string;
  imageUrl?: string;
}

/**
 * Scrape Discover card articles from whatever page is currently loaded.
 *
 * Strategy: each card is a `[data-hveid]` element containing leaf text nodes.
 * Google Discover does NOT use <h3> or <a href> — it uses styled divs and
 * jsaction click handlers. We extract fields heuristically:
 *   - Title   = longest leaf text node  (20–300 chars)
 *   - Age     = leaf text matching time-unit pattern ("2h ago", "1d", etc.)
 *   - Source  = short leaf text that isn't title or age (< 60 chars)
 *   - URL     = a[href] if present, else data-url attribute on the card
 *   - Image   = first img[src] in the card
 */
export async function scrapeDiscoverCards(
  page: Page,
  containerSel: string,
  count: number
): Promise<Article[]> {
  const articles = await page.evaluate(
    ({ sel, n }) => {
      const containers = Array.from(document.querySelectorAll(sel))
        .filter((el) => (el.textContent?.trim().length ?? 0) > 30)
        .slice(0, n);

      return containers.map((card) => {
        // URL: prefer a[href], then data attributes (Google uses jsaction on mobile)
        const linkEl = card.querySelector("a[href]") as HTMLAnchorElement | null;
        const url =
          linkEl?.href ??
          card.getAttribute("data-url") ??
          card.getAttribute("jsdata") ??
          "";

        const imgEl = card.querySelector("img[src]") as HTMLImageElement | null;

        // Collect all leaf text nodes — no children, non-empty, within title/source/age length range
        const allText = Array.from(card.querySelectorAll("div, span"))
          .filter((el) => el.children.length === 0)
          .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter((t) => t.length > 3 && t.length < 300);

        // Title: longest text node (articles titles are always the longest string in the card)
        const sorted = [...allText].sort((a, b) => b.length - a.length);
        const title = sorted[0] ?? card.textContent?.trim().slice(0, 200) ?? "";

        // Age: first text matching common time-unit patterns
        const ageText =
          allText.find((t) =>
            /\b(\d+\s*(m|h|d|w|min|hour|day|week|month|year)s?\b|yesterday|today|just now)/i.test(t)
          ) ?? "";

        // Source: short text that is not title or age
        const sourceText =
          allText.find(
            (t) =>
              t !== title &&
              t !== ageText &&
              t.length > 2 &&
              t.length < 60 &&
              !/^\d/.test(t)
          ) ?? "";

        return {
          title,
          source: sourceText,
          age: ageText,
          url,
          ...(imgEl?.src ? { imageUrl: imgEl.src } : {}),
        };
      });
    },
    { sel: containerSel, n: count }
  );

  return articles.filter((a) => a.title.length > 0);
}
