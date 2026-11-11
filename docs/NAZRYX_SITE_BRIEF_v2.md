# nazryx.com rebuild, round 2: brief for Claude Code

Read this first. It overrides `NAZRYX_SITE_BRIEF.md` wherever the two disagree.

## Omar's decisions, 11 Nov 2026. These override everything below and in the other files.
1. **Hero line:** keep the current tagline, **"Bridging the gap in medical trade across frontier markets."** The other hero lines in the facts file are alternatives for sub-headings only.
2. **Proof numbers confirmed for public use:**
   - **14,000+ register records read**
   - **300+ distributors profiled**
   - **88,000+ state lots read**

   **"120+ suppliers" and "60+ therapeutic classes" stay off the site.**
3. **Software: show it as beautiful mockups, not screenshots.**
   - Build stylised HTML/SVG mockups of the Nazryx platform (app.nazryx.com) in the site's design language. Possible panels:
     - a market-read table with Crowded / Thin / Open chips
     - a register-scan panel
     - a state-lot tracker
     - a weekly-report card
     - a distributor shortlist with names blurred
   - Base the layout and modules on the real app. Omar gives access or sends reference screens.
   - **All data inside the mockups is demo data:** Kazakhstan demo molecules from `kz_demo_molecules.json` and invented, clearly generic product names. Never real client, distributor or buyer names, and never real client figures.
   - Use them as the visual for the "Intelligence" layer and next to the distributors' "Your private portal" section. One line under the visual: "Our own platform, built for these markets."
4. **List every market we serve. 14 markets on 3 continents, each with a card on `/markets`:**
   - **Central Asia and the Caucasus:** Kazakhstan, Uzbekistan, Azerbaijan
   - **East Africa:** Kenya, Uganda, Tanzania, Rwanda
   - **West Africa:** Nigeria, Ghana, Senegal, plus francophone West and Central Africa as one regional card
   - **North Africa and the Horn:** Sudan, Libya
   - **Middle East:** Iraq
   - **South America:** Peru

   This changes every "7 markets" in these files to "14 markets on 3 continents":
   - The stats tile reads "14 markets · 3 continents".
   - The bridge animation and the map show all 14 plus the regional card.
   - The manufacturers page section becomes "14 markets. We work each one ourselves." with tabs for each region.
   - Kazakhstan remains the one market shown in full, and is still never presented as the only market.
   - Facts for the 7 newly added markets are in `NAZRYX_SITE_FACTS.md`, section B2. Updated headline totals are in section A1.
5. **Ignore the line "Iraq: one central state buyer, about USD 2bn a year"** in the section below. Use the Iraq facts in `NAZRYX_SITE_FACTS.md`: about USD 3bn of medicine imports a year, and Kimadia as the single state importer.

## What went wrong in round 1
The preview (claude-site-rebuild.nazryxsite.pages.dev) fixed the facts but lost too much:
- **The home page is thin.** It has 5 sections with large empty areas. The services, the Kazakhstan spotlight, the eye-care case, the commitments and the markets section are gone.
- **The design is weaker.** The original premium dark manufacturers page became a generic light template: pastel tiles and blue boxes, repeated on every page.
- **The demos start empty.** The register scan opens on "Choose a molecule…", and the scroll story leaves screen-high blank gaps.
- **There is less data.** The site now says less than the old one.

The cause was round-1 rules such as "home in 5 sections", "fewer cards", "one light theme" and "remove the dark sections". Those rules are withdrawn.

## Copy and market facts
`NAZRYX_SITE_FACTS.md` holds:
- the company copy (what we do, why Nazryx, how it starts)
- checked facts for all 7 markets
- two more animations: the imports bar chart (C1) and the registration clocks (C2)

Use it as the source for all copy and all non-Kazakhstan facts. It replaces the "Facts for the other markets" bullet below.

## Seven markets, not one
Nazryx works in 7 markets. Kazakhstan is the market shown in full detail because its data is the deepest. It must never look like the only market.
- **Navigation:** `For manufacturers` · `Markets` · `For distributors` · `Talk to us`. There is no "Kazakhstan" item in the top navigation.
- **New hub page `/markets`:** all 7 markets as equal cards (Kenya, Uganda, Tanzania, Sudan, Iraq, Uzbekistan, Kazakhstan). Each card has:
  - the region
  - what Nazryx runs there
  - one or two confirmed facts
  - a link: "Full market file" for Kazakhstan, "Market file on request" for the others
  - a flat SVG map at the top showing the 7 markets and the sourcing countries
- **Kazakhstan page moves to `/markets/kazakhstan`,** with a redirect from `/kazakhstan`. It opens with "One of our seven markets, shown in full", as the original spotlight did. Later market pages follow the same template.
- **Home page balance:**
  - Kazakhstan content is at most one block on the home page.
  - The hero, stats and demo speak about all markets first.
- **Hero card:** replace "Kazakhstan now" with a **"Markets we run"** card, one row per market with a one-line role.
  - East Africa: Tanzania, Kenya, Uganda, register-led and tender-heavy.
  - Sudan and the Horn
  - Iraq
  - Central Asia: Kazakhstan, Uzbekistan
- **Stats:** at most 2 of the 6 tiles may be Kazakhstan-only. Suggested set:
  - 7 markets
  - 3 · 10 manufacturers represented
  - 6 source countries
  - 9,270+ register records read in Tanzania
  - 1,340 pharmacies tracked in Kazakhstan
  - 1,000+ physicians in our Kazakhstan network
- **Register scan demo:**
  - A market switch above it. Kazakhstan is live; the other 6 markets are shown greyed with "We run this read here too: send your product list".
  - Label the demo "Example: Kazakhstan".
  - Sub-line: "We run the same read in every market we serve: register, shelves or tenders, and the state buyer."
- **Manufacturers page:**
  - Keep the original "Seven markets. We work each one ourselves." section and its region cards, plus the 1/7 market tabs.
  - The Kazakhstan spotlight stays as the tab that is filled in.
  - The eye-care case stays as an example from another market.
- **Distributors page:** keep the multi-market framing and the 53 veterinary registrations case.
- **Facts for the other markets.**
  - Use only these or the original site text:
    - Tanzania: 9,270+ registered product records analysed; official tender sources tracked.
    - Iraq: one central state buyer, about USD 2bn a year in procurement.
    - Kenya, Uganda, Sudan, Uzbekistan: original site wording.
  - Anything else on these markets is marked `<!-- TODO Omar: confirm -->` and stays off the live page.
  - Never name buyers, distributors or clients in any market.

## Round 2 principle: add and correct, never thin out
1. **Start again from the original live site (nazryx.com), not from the round-1 build.** Keep every original section, layout and visual style unless a rule below changes it.
2. **Fix text in place.** Every original claim either stays as it is, is corrected to the facts sheet (round-1 brief, section 1), or is removed only if it is on the "never" list. Rewrite a section only when its facts are wrong.
3. **Add, don't swap.** The interactive pieces and new data blocks go on top of the original content. The site should end up with more information than before.
4. **The round-1 build is a parts bin.** Its working components may be reused inside the original design: the register scan, the price bars, the doctors bars, the registration toggle, the state-round tiles, the contact card and the mobile menu. Restyle them to the original look.

## Design: keep the original, refine it
- **Keep the original look:**
  - the light home page
  - the dark, premium manufacturers and distributors pages: deep navy background, high-contrast type, thin borders
  - the large display headlines
  - the numbered service cards
- **Allowed refinements:**
  - Use one brand blue (#1259E6) for accents on every page.
  - Remove only the decorative glows and radial gradients behind the cards. Flat dark navy panels stay.
  - Drop pink and purple tiles: use blue, green and amber accents on the dark pages, and blue and soft-blue on the light ones.
  - Tighten the spacing where the original wastes space.
- **Density rule.**
  - No viewport-height block may be more than about 30% empty at 1440 px.
  - Scroll stories may not leave blank screens. If sticky scrolling causes gaps, use a compact stepped version instead.
- **First impression.**
  - Every demo shows a filled, animated result on first view. The register scan auto-runs Apixaban when it scrolls into view, and the visitor can then pick another molecule.
  - Charts animate in already filled with data, never from an empty state.
- **Mobile.** Keep the round-1 mobile header fix and the tap-to-call phone links.

## Page-by-page

### Home `/` (light, as the original)
Keep all the original sections, in this order, with these changes:
1. **Hero.**
   - Keep the original hero line, or use "Your export team for frontier markets".
   - Replace the "3 Countries" card with the **"Markets we run"** card (see "Seven markets, not one").
2. **Stats.**
   - Use 6 tiles in place of the old fake ones:
     - 3 · 10 manufacturers represented
     - 1,340 pharmacies tracked
     - 1,000+ physicians
     - 7 markets
     - 9,270+ register records read in Tanzania
     - 6 source countries
     - No more than 2 Kazakhstan-only tiles (see "Seven markets, not one").
   - Remove "$4.6B+", "30+ sources" and "80% / 5x / 3x".
3. **Who we serve.** Keep the original two audience cards.
4. **Register scan demo**, full width and auto-running (see above).
5. **What we do: keep all 6 original services** and their text, with facts corrected.
6. **Markets block:** the 7-market map with region cards. Kazakhstan is shown as "one market in full" (4 figures and a link to /markets/kazakhstan) next to the others.
7. **Markets.** Keep the original market chips and add a flat SVG map of the 7 markets.
8. **"Why work with us".** Keep it, without the unbacked numbers.
9. **Contact.** Keep the round-1 contact card, with no addresses.

### Manufacturers `/manufacturers` (dark, as the original)
Keep the original sections and order:
- hero
- "Eight things we run"
- the eye-care case ("12 eye-care medicines. Zero suppliers")
- the seven markets
- the Kazakhstan spotlight
- "One dossier. Four markets."
- who holds what
- commitments
- how it starts
- fit
- FAQ
- CTA

Changes:
- **Facts:**
  - registrations in your name
  - national route open until 31 Dec 2027
  - 9,659 pharmacies
  - title: Director, International Business
  - "team on the ground"
  - no addresses or entity names
- **Kazakhstan spotlight:**
  - Remove "+16%".
  - Change the $1.1bn figure to "976 lots, about $860m, 2027 round".
  - Add the retail and hospital split plus the imported share by value and by packs (data below).
- **Add, after "Eight things we run":** the registration-route toggle, restyled dark.
- **Add, after the eye-care case:** the "120 → 15" catalogue funnel as a compact horizontal stepper. No sticky scroll, no blank screens.
- **Add, before the FAQ:** the sample-profile viewer. Keep the skeleton until Omar supplies a page.

### Distributors `/partners` (dark, as the original)
- Keep everything except the "The platform" self-serve section. Replace it with "Your private portal" (a static mock-up, same dark style).
- Correct the source counts to one number, which Omar confirms.

### Kazakhstan `/markets/kazakhstan` (new, keep round 1 and add data; `/kazakhstan` redirects here)
The round-1 page is the best of the build: keep it and add the data below, so it reads as a real market file. It can use the dark style if that matches the manufacturers page better. Choose one and show Omar both.

## More data to add (all confirmed, Nov 2026)

| Block | Data |
|---|---|
| Market by channel 2025 | Retail KZT 754.7bn, 448.1m packs (57% of value, 83% of packs). Hospital KZT 561.8bn, 89.0m packs. Total KZT 1.3trn ≈ USD 2.5bn, 537m packs. |
| Imports | 85% of value, 68% of packs. |
| Pharmacies and chains | 9,659 pharmacies. Chains hold 76–77% of pharmacy turnover. The top 15 chains run 2,507 pharmacies and hold 50.5% of turnover. Do not name chains. |
| State round 2027 | 976 lots, about USD 860m. One national buyer, one round a year. Local and EAEU producers have priority. |
| Doctors 2025 | 83,994 doctors (excluding dentists). By specialty, as on the round-1 page. |
| Registration | National route to 31 Dec 2027, valid in Kazakhstan. EAEU route: 140 working days plus clock stops, reference state Kazakhstan, extendable to RU, BY, AM, KG. Validity 5 years, then permanent. GMP inspection of the plant by the Kazakh inspectorate. |
| Labelling and marking | Kazakh and Russian on every pack. Data Matrix on every pack since 1 Jul 2024. |
| Tax | VAT on medicines: 5% in 2026, 10% from 1 Jan 2027. Import duty on finished medicines (HS 3004): 0% in Kazakhstan. |
| Price position | Index by producer country, as in round 1. |
| Register scan | The 14 molecules in `kz_demo_molecules.json`. |

Show these as small charts and tables, not paragraphs:
- a stacked bar for retail against hospital
- a value-against-packs bar for imports
- a donut or bar for chains against independents
- a timeline for VAT and marking

## Unchanged from round 1
- The facts sheet.
- The "never on the site" list.
- No addresses and no legal entity names. The footer reads "© 2026 Nazryx".
- No client or distributor names.
- Reduced motion, accessibility, the Open Graph image and the SEO items.

## Done means (round 2)
- [ ] Kazakhstan is not in the top navigation. The home page leads with all markets, and at most 2 stat tiles are Kazakhstan-only.
- [ ] Every original section is still present, unless it is listed above as removed (the platform section, the fake stats, the addresses and entity names).
- [ ] Side-by-side screenshots of old and new, for every page at 1440 px and 390 px. The new site carries at least as much information on each page.
- [ ] Every demo and chart shows data on first view, with no empty states and no blank scroll gaps.
- [ ] The dark pages still look dark and premium. The light home still looks like the original, refined.
- [ ] Every round-1 check still passes.
- [ ] Nothing goes live until Omar approves.
