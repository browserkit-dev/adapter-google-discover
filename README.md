# @browserkit/adapter-google-discover

[Google Discover](https://www.google.com) feed adapter for [browserkit](https://github.com/browserkit-dev/browserkit) — returns personalised articles from your Google Discover feed, running in Pixel 5 mobile emulation so the feed is available even before the desktop rollout reaches your account.

## Requirements

- A Google account with Discover enabled (available in US, UK, Canada, Australia, NZ, Germany)
- [browserkit](https://github.com/browserkit-dev/browserkit) installed and running

## Login

**One-time setup** — run this once to authenticate:

```bash
browserkit login google-discover
```

This opens a visible Chrome browser in Pixel 5 mobile emulation. Log into your Google account normally. The session is saved to a persistent profile directory. Close the browser when done.

> **CAPTCHA note:** Google may ask you to verify you're human during login.
> Complete the verification manually — the browser is visible for exactly this reason.
> After a successful login, subsequent headless runs reuse the saved session without
> prompting again (unless the session expires).

## Tools

| Tool | Input | Description |
|---|---|---|
| `get_feed` | `count: 1–30` | Personalised Discover articles: title, source, age, URL, topic, thumbnail |

Plus 5 auto-registered management tools from the framework: `health_check`, `set_mode`, `take_screenshot`, `get_page_state`, `navigate`.

### Article shape

```typescript
interface Article {
  title: string;
  source: string;       // publisher e.g. "BBC News"
  age: string;          // e.g. "3 hours ago"
  url: string;          // article URL
  topic?: string;       // topic label if shown e.g. "Technology"
  imageUrl?: string;    // thumbnail URL if present
}
```

## Configuration

```javascript
// browserkit.config.js
import { defineConfig } from "@browserkit/core";

export default defineConfig({
  adapters: {
    "@browserkit/adapter-google-discover": {
      port: 3849,
      deviceEmulation: "Pixel 5",  // required — Discover is a mobile-first surface
    },
  },
});
```

```bash
browserkit start
```

Connect your MCP client to `http://127.0.0.1:3849/mcp`.

## Why mobile emulation?

Google Discover is still rolling out to desktop browsers and is not available for all accounts. By running the browser in Pixel 5 emulation, `google.com` serves the full mobile Discover feed regardless of desktop rollout status. The `deviceEmulation` config field in browserkit triggers this automatically — your other adapters (LinkedIn, HN, etc.) are unaffected.

## Selector stability

Google uses dynamically-generated class names that change frequently. This adapter uses `data-hveid` attributes and semantic HTML (`h3`, `a[href]`) which are far more stable — Google uses them for internal analytics. If the feed stops returning results, run:

```
health_check
```

The selector health report will show which selectors are no longer found on the live page, making it easy to identify what changed and update `src/selectors.ts`.

## Tests

```bash
pnpm test                # unit + MCP protocol + reliability (no auth required)
pnpm test:integration    # live Discover feed (requires google-discover login)
```
