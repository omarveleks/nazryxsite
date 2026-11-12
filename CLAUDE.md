# Nazryx website — rules

Static HTML on Cloudflare Pages. Published folder: `site/` (Pages output directory = `site`). Functions live in `functions/`.

## Sources
- `docs/NAZRYX_SITE_BRIEF_v2.md` (round 2) overrides `docs/NAZRYX_SITE_BRIEF.md`. Facts: `docs/NAZRYX_SITE_FACTS.md` (all markets) and section 1 of the round-1 brief (Kazakhstan).
- All copy and figures live in `content/site.json` (shared) and `content/pages/*.json` (one file per page, an ordered list of typed sections).
- `python3 tools/build.py` renders them into `site/`. Edit the JSON, never the generated `site/*.html`. Every page needs 6+ sections (the build checks).
- Positioning: a market data and market entry agency for manufacturers. Primary call to action everywhere: "Request a market read" (/start).

## Design
- Light pages by default; /market-entry and /distributors use the dark theme. Large Inter Tight headlines, numbered cards, blue/mint/peach tiles.
- One brand blue #1259E6 for accents. No glows, radial gradients, drop shadows or glass blur. No pink or purple.
- One stylesheet, `site/assets/css/site.css`, with light and dark token sets.
- Fonts self-hosted (Inter, Inter Tight). Every demo and chart shows data on first view. Respect prefers-reduced-motion.
- Mobile-first: no horizontal scroll at 360px; header fits one line at 390px.

## Copy
- Short, concrete, confident ("You make medicines. We run Kazakhstan."). No jargon unless it matters (keep EAEU).
- Facts only from the facts file and brief section 1; anything else gets a `<!-- TODO Omar: confirm -->` and stays off the page.
- Never publish client, principal, prospect, distributor, importer or chain names, fees or margins, addresses, or any legal entity name. Brand is "Nazryx"; "Part of the Nazir Group" may appear once in the footer.
- Molecule names only from `site/assets/data/kz_demo_molecules.json`; never add one without Omar's approval.
- Teams are in Lahore and on the ground in Almaty ("team on the ground", never "office"). Omar's title: Director, International Business.
- 14 markets on 3 continents; Kazakhstan is shown in full but never as the only market. State buyers and regulators may be named.

## Security
- Never write any password, token or secret into the repo, code, comments, logs or previews. Secrets live only in Cloudflare (`wrangler pages secret put`).
- Only web files go in `site/`. Nothing private (spreadsheets, dumps, client files, notes) is ever committed.

## Workflow
- Work on a branch, share the Cloudflare preview URL, merge to main only with owner approval.
- Ask before anything destructive and before deploying to production.
