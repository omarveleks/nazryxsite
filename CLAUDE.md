# Nazryx website — rules

Static HTML on Cloudflare Pages. Published folder: `site/` (Pages output directory = `site`). Functions live in `functions/`.

## Design
- Reuse the site's existing CSS, tokens, fonts (Inter, Inter Tight) and components. No new visual styles.
- Flat design: no drop shadows, no blur, no glows, no pink, no new gradients. Only gradients the site already uses.
- Light ground #F7F6F2, blue #0066FF, flat pastel tiles, white rounded cards.
- Mobile-first: everything must work at 375px.

## Copy
- Short, concrete, confident ("You make medicines. We run Kazakhstan."). No jargon unless it matters (keep EAEU).
- Never publish client names, other manufacturers' names, distributor names, fees or costs, NDA wording, personal names, or specific molecule names.

## Security
- Never write any password, token or secret into the repo, code, comments, logs or previews. Secrets live only in Cloudflare (`wrangler pages secret put`).
- Only web files go in `site/`. Nothing private (spreadsheets, dumps, client files, notes) is ever committed.

## Workflow
- Work on a branch, share the Cloudflare preview URL, merge to main only with owner approval.
- Ask before anything destructive and before deploying to production.
