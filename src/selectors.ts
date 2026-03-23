/**
 * Google Discover DOM selectors.
 *
 * FRAGILITY WARNING: Google uses dynamically-generated, obfuscated class names
 * (e.g. "DY5T1d", "JtKRv") that change unpredictably with deployments. The
 * selectors here anchor on structural attributes (data-hveid, data-ved) and
 * semantic elements (h3, a[href], img) that are far more stable — Google uses
 * them for internal analytics and rarely renames them.
 *
 * If the Discover feed stops working, run `browserkit health_check google-discover`
 * first. It will report which selectors are no longer found on the live page,
 * making it easy to identify what changed.
 *
 * Confirmed from Google mobile web DevTools inspection (Pixel 5 UA, 2025).
 */
export const SELECTORS = {
  /**
   * Outer wrapper of each Discover card.
   * Google uses data-hveid for hyperlink Vip Entity IDs — present on all
   * clickable result cards across Search, Discover, and News. Very stable.
   */
  cardContainer: "[data-hveid]",

  /**
   * The article title within a card.
   * Google consistently uses <h3> for result/card titles across all surfaces.
   * If h3 disappears, [role="heading"] is the fallback.
   */
  cardTitle: "h3",

  /**
   * The clickable anchor wrapping the card content.
   * Google Discover links are either direct article URLs or redirect URLs
   * of the form /url?q=https://... or articles/CBMi... (for news.google.com).
   * On google.com/discover mobile, they are typically direct article URLs
   * in data-url or href attributes.
   */
  cardLink: "a[href]",

  /**
   * Publisher/source name. Google renders the source as a small text element
   * near the title. The pattern is a <span> or <div> that appears before or
   * after the title with a short string (publication name).
   * This is the most fragile selector — class names change most here.
   * Using [data-ved] ancestor + positional text-node extraction as fallback.
   */
  cardSource: "[data-ved] span",

  /**
   * Relative age string (e.g. "3 hours ago", "Yesterday").
   * Rendered in a <span> or <time> near the source. Often the last short
   * text span in the card metadata section.
   */
  cardAge: "time, [aria-label*='ago'], [aria-label*='hour'], [aria-label*='day']",

  /**
   * Card thumbnail image.
   */
  cardImage: "img[src]",

  /**
   * Google account avatar in the top-right of the mobile Google homepage.
   * Present when logged in. Used by isLoggedIn() to detect auth state.
   * Selector anchors on the img inside the account menu button.
   */
  accountAvatar: "img[data-atf][src*='googleusercontent.com'], [aria-label='Google Account'], a[href*='accounts.google.com'] img",

  /**
   * The Discover feed scroll container. Present on mobile google.com when
   * logged in and Discover is active.
   */
  feedContainer: "[data-hveid], .klitem-tr, [jsname][jscontroller]",
} as const;
