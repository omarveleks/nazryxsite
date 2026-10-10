# nazryx.com

Static site on Cloudflare Pages, with Pages Functions for the Markets pages and private analytics.

| Path | What |
|---|---|
| `site/` | Published folder (Pages **build output directory = `site`**, no build command) |
| `functions/` | Pages Functions: `/markets`, `/markets/:country`, `/api/collect`, `/api/stats`, `/analytics/*` |
| `content/markets/` | One file per country. Add `content/markets/<slug>.js` and list it in `content/markets/index.js` |
| `migrations/` | D1 schema (`wrangler d1 migrations apply nazryx-analytics --remote`) |
| `wrangler.toml` | D1 binding `DB` → `nazryx-analytics` |
| `platform/` | Nazryx Intelligence Platform (Next.js + Postgres + Python ingest). Not part of the Pages site. See `platform/README.md` |

## Analytics: what is stored

First-party only, no third-party trackers, no cookies for visitors.

- Per event: time, event type (pageview, time on page, scroll depth, tracked click, form submit), page path, referrer **host** only, UTM source/medium/campaign, the `ref` link parameter, country and city (from Cloudflare), device type, browser and OS family, language.
- Visitor key: SHA-256 of a random **daily** salt + IP + user agent. The salt is replaced every UTC day and the old one deleted, so keys can't be linked across days or turned back into an IP. **IP addresses are never stored.**
- The browser keeps one non-identifying flag (`nzx_seen=1` in localStorage) so "new vs returning" can be estimated. No ID is stored.
- Bots, prefetch/prerender, cross-origin posts, and `/analytics` and `/api/*` paths are dropped.
- Retention: raw events for 13 months, then rolled into `daily_agg` (daily counts per page, source, country, device) and deleted. Login lockout rows are kept for at most 24 hours.

## Access

`/analytics` and `/api/stats` are gated server-side (`functions/analytics/_middleware.js`, `functions/api/stats.js`).
Secrets live only in Cloudflare (Pages → Settings → Variables and Secrets, type **Secret**, Production and Preview):

- `ANALYTICS_PASSWORD`: dashboard password.
- `ANALYTICS_SESSION_KEY` (optional): extra key for signing the login cookie. If it's not set, one is derived from the password.

To rotate: change the value in Cloudflare, then redeploy (Deployments → ⋯ → Retry deployment). Changing `ANALYTICS_SESSION_KEY` logs everyone out.
For local testing, put throwaway values in `.dev.vars` (git-ignored) and run `npx wrangler pages dev site`.
