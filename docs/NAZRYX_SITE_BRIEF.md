# nazryx.com rebuild: brief for Claude Code

Owner: Omar Nazir (Nazryx). Date: 11 Nov 2026.
Goal: rebuild nazryx.com so it is beautiful, factual, and lets a manufacturer see what Nazryx does instead of being told. This is a rewrite of the company story on the site, not a copy patch.

Files that come with this brief:
- `NAZRYX_SITE_BRIEF.md`: this file.
- `kz_demo_molecules.json`: real Kazakhstan register and shelf data for the interactive demo in section 6A.

---

## 0. Working rules for Claude Code

1. **Start from the live site.** The original files were lost. Download the live HTML, CSS, JS and assets of `/`, `/manufacturers` and `/partners` from https://nazryx.com before changing anything. Commit that copy as the baseline.
2. **Keep the stack simple.** The site is plain HTML served by Cloudflare. Use static HTML, CSS and vanilla JS, with no build step unless it is clearly needed. Small libraries are fine if they are vendored locally. No React or framework.
3. **Keep the URLs.** `/`, `/manufacturers` and `/partners` must still work. New pages are added (section 5).
4. **Facts come only from section 1.** If a sentence needs a fact that is not in section 1, mark it `<!-- TODO Omar: confirm -->` and leave it out of the live page.
5. **Meet the section 9 checks before saying it is done.** Post screenshots of every page at 1440 px and 390 px wide.
6. **Ask Omar** before deleting any page, changing a URL, or publishing to Cloudflare.

---

## 1. Source of truth: what the site may say

### The company
| Item | Use on the site |
|---|---|
| Name | Nazryx (always this spelling) |
| Tagline | Bridging the gap in medical trade across frontier markets. |
| What it is | An export team for pharmaceutical manufacturers. Nazryx registers products, appoints importers and distributors, runs promotion and state bids, and reports weekly. For distributors it also runs the sourcing and market-intelligence function. |
| Model | Agent, not a distributor. Nazryx never takes title to stock. Paid on results: commission on sales, agreed per market. No fee for introductions. |
| Registrations | Always held in the manufacturer's name. Nazryx acts as local representative and is never the holder. The manufacturer keeps the product, dossier, plant and brand. |
| Teams | Team in Lahore, Pakistan. Team on the ground in Almaty, Kazakhstan. Always say "team on the ground", never "office". |
| Legal name on the site | **None.** Nazryx has legal entities in several countries, so the site names no entity. The brand is simply "Nazryx". |
| Addresses | **None.** No street addresses anywhere on the site: not in the footer, contact block, schema markup or meta tags. City names (Lahore, Almaty) are fine. |
| Manufacturers represented | 3 in Kazakhstan, 10 worldwide. Selected, exclusive partnerships. No names, ever. |
| Kazakhstan capability (confirmed by Omar) | 100+ local distributor relationships. 1,000+ physicians in the network. Direct physician outreach. Local regulatory and government services. Product and document translation done in-house. |
| Markets | Kenya, Uganda, Tanzania, Sudan, Iraq, Uzbekistan, Kazakhstan (the 7 on the current site). Kazakhstan is the lead market and is shown first. |
| Exporting from | Pakistan, Bangladesh, Turkey, Egypt, Europe and South Korea. |
| Phones | UK +44 7466 253544 (WhatsApp) · Kazakhstan +7 708 692 2409 (WhatsApp) · Pakistan +92 325 4307967 |
| Email | contact@nazryx.com, shown in plain text |
| Omar's title | Director, International Business. Not "Principal Director". |

### Kazakhstan facts (source: Nazryx Kazakhstan data, Nov 2026)
| Fact | Value |
|---|---|
| Population | about 20.3 million |
| Medicines market 2025, retail and hospital | USD 2.5bn (KZT 1.3 trn) |
| Imported share of value | 85% |
| Pharmacy share of value | 57% |
| Pharmacies | 9,659 |
| Chains' share of pharmacy sales | about three quarters; the top 15 chains run 2,507 pharmacies and hold half of sales |
| Tracked by Nazryx | 1,340 pharmacies in 17 cities, read SKU by SKU |
| State buyer | SK-Pharmacy, one national round a year. The 2027 round has 976 lots worth about USD 860m. |
| Registration | The national route is open until 31 Dec 2027 and valid in Kazakhstan only. The EAEU route takes 140 working days plus clock stops, with Kazakhstan as reference state, and can be extended to Russia, Belarus, Armenia and Kyrgyzstan. |
| Labels and marking | Kazakh and Russian on every pack. Data Matrix code on every pack since 1 Jul 2024. |
| VAT on medicines | 5% in 2026, 10% from 1 Jan 2027 |
| Shelf price of the same medicine by producer country (India = 1.00) | Russia 0.75 · Kazakhstan 0.97 · Pakistan 0.98 · India 1.00 · Slovenia 1.18 · Turkey 1.34 · Western Europe 1.41 · Germany 1.43 |
| Doctors 2025 | Therapists 6,908 · Gynaecologists 5,279 · Paediatricians 4,893 · Neurologists 2,649 · Cardiologists 1,995 · Endocrinologists 1,073 · Dermatovenereologists 926 · Urologists 870 |

### Numbers to confirm with Omar before use (TODO)
- "14,000+ register records read", "300+ distributors profiled", "88,000+ state lots read", "664 essential medicines cross-referenced". These are on the current site; keep them only once confirmed.
- "One state buyer spends about USD 1.1bn a year" on the current site conflicts with the 2027 round of about USD 860m. Use the 2027 figure.
- "+16% forecast growth 2026": remove unless Omar has the source.

### Never on the site
- **Unbacked numbers:**
  - "$4.6B+ total addressable market"
  - "Up to 80% time saved / 5x data / 3x leads"
  - "30+ data sources", which conflicts with "500+ sources"
- **Filler stats:** "120+ supplier relationships" and "60+ therapeutic classes" as headline stats.
- **Names:** any client, principal or prospect manufacturer, and any distributor or importer.
- **Commercial detail:** prices, margins or fees. "Paid on results / commission per market" is fine.
- **Wrong rules:** "EAEU rules apply to all new medicines from 2026". That is wrong; see the registration row.
- **Addresses** of any kind (Lahore, London/Slough, Almaty). The current contact block and footer list three: remove them all.
- **Any legal entity name:** Nazryx Ltd, Nazir & Company, Nazir & Company International (PVT) Limited, Nazir Construction Concept, ТОО «Nazryx», or any other "Ltd" or "Pvt" name. Remove the construction-group paragraph and the PEC licence.
- **Wording that sounds generated:**
  - "seamless", "cutting-edge", "unlock", "empower", "leverage"
  - exclamation marks
  - emoji

---

## 2. Story and structure (rewrite)

The site tells one story: **we read the market line by line, we show you what is open, and we run the launch in your name.** Every page proves it with real data or an interactive demo.

Navigation: `For manufacturers` · `Kazakhstan` · `For distributors` · `Talk to us` (button). On mobile, the logo sits left and a menu button right, and the button opens a full-height panel.

### Home `/` (5 sections)
1. **Hero.**
   - Headline: "Your export team for frontier markets."
   - Sub: "We read each market's register, shelves and state purchases, show you where your products fit, and run the launch in your name: registration, importers, doctors and state bids."
   - Buttons: "See what's open" (scrolls to the 6A demo) and "Talk to us".
   - Right side: a flat "Kazakhstan now" card with $2.5bn market · 9,659 pharmacies · 85% imported · EAEU reference state.
2. **Proof strip, 4 figures:**
   - 3 manufacturers represented in Kazakhstan · 10 worldwide
   - 1,340 pharmacies tracked
   - 1,000+ physicians in our Kazakhstan network
   - 7 markets
3. **Try it: the register-scan demo** (section 6A).
4. **Two doors:** For manufacturers / For distributors, one sentence each and a link.
5. **Contact block** with phones, email, WhatsApp and a booking button.

The services list, the Tanzania 86/100 mock-up, the "Why not in-house" block and the 80%/5x/3x block are removed from the home page.

### Manufacturers `/manufacturers`
Order:
1. **Hero.** "Launch into new markets. Keep the registrations in your name."
2. **"What we run" in 6 short cards** (2 bullets each):
   - choose what to launch
   - register
   - pass quality checks
   - importer and chains
   - doctors and promotion
   - state bids and reporting
3. **"From your catalogue to a plan"** scroll story (section 6B).
4. **"Registration route"** toggle (section 6C).
5. **Who holds what:**
   - You keep the product, dossier, plant, brand and registrations.
   - Nazryx is the local representative.
   - The importer can be replaced.
6. **Sample product profile viewer** (section 6G).
7. **What we put in writing.** Keep the four commitments, signed "Omar Nazir, Director, International Business".
8. **How it starts:**
   - 20-minute call
   - Market read in 2–3 weeks
   - Proposal
   - Filing
   - First sales 12–24 months after filing, depending on route
9. **Fit / not a fit.** Keep it.
10. **FAQ.** Keep it, and add "Do we need an EAEU GMP certificate?" and "Whose name is on the registration?"
11. **Contact.**

The Kazakhstan spotlight moves to its own page, with a 3-figure teaser here linking to it.

### Distributors `/partners`
- Keep the "We run the function" story and the eight functions, shortened to 2 lines each.
- **Remove the "The platform" section.** It describes a self-serve tool and contradicts "we run the function". Replace it with a short "Your private portal" card showing a static portal mock-up.
- Show the 53-veterinary-registrations case once, here only.
- Use distributor-specific stats instead of repeating the home strip: 7 markets · weekly reports · suppliers vetted per category · RFQs run. Use counts only once Omar confirms them.

### New: Kazakhstan `/kazakhstan`
- Market figures, the chains block and the state buyer block, all from section 1.
- Price position by producer country, as an animated bar chart (section 6D).
- Doctors by specialty.
- Registration route (6C) and the EAEU map (6E).
- Labels, marking and VAT.
- What Nazryx runs on the ground in Almaty.
- CTA: "Send your product list. We'll show you what's open."

### New: Sample `/sample`
- One anonymised two-page product profile, in the same layout as the PDFs.
- Omar supplies an approved anonymised page. Until he does, show a skeleton with "Sample available on request".

---

## 3. Visual design system (one theme everywhere)

The current site mixes a light home page with a dark manufacturers page and uses gradients. Move everything to one light, flat system that matches the Nazryx PDFs.

**Colours (CSS variables)**
- `--bg: #F6F4EF` (cream page)
- `--surface: #FFFFFF` (cards)
- `--ink: #141414` (text)
- `--muted: #5A5A5A` (secondary text)
- `--line: #E3E0DA` (borders)
- `--blue: #1259E6` (the only brand colour; replaces #0066FF everywhere, including `theme-color`)
- `--blue-soft: #DCE8FD` and `--blue-mid: #9DB9F2` (tints for charts and tiles)
- `--green-soft: #D9F0E3` and `--peach-soft: #FBE5D6`: allowed only as flat KPI tile fills, as in the PDFs

**Not allowed:**
- gradients
- glows
- drop shadows
- blur or glassmorphism
- pink or purple
- dark full-width sections (allowed at most once, for the footer)

**Type**
- Inter, self-hosted: 400, 500, 600, 700.
- Display: 56/60 px desktop, 36/40 mobile, weight 700, letter-spacing -0.035em. The second half of a headline is blue, as in the PDFs ("Kazakhstan: **an import market…**").
- Body: 17 px, line height 1.6, max width 68 characters.
- Numbers use tabular figures (`font-variant-numeric: tabular-nums`).

**Layout**
- 12-column grid, max width 1200 px, 24 px gutters, 16 px side padding on mobile.
- Sections have 120 px vertical rhythm on desktop and 72 px on mobile.
- Fewer nested cards: text sits on the page; cards are for data and demos only.
- Card radius 16 px, 1 px `--line` border, no shadow.

**Imagery**
- No stock photos of pills or handshakes.
- Real visuals only:
  - data graphics built from section 1
  - product-profile thumbnails
  - a simple flat SVG map of the markets
  - one real photo of the Almaty team or city, if Omar supplies it

**Icons**
- One outline set (for example Lucide, vendored), 1.5 px stroke.

---

## 4. Motion principles

- **Purpose.** Every animation shows how something works or reveals data. Decoration alone is not a reason.
- **Trigger.** Animations start on scroll into view (IntersectionObserver) and run once. No autoplay loops, except the subtle scan line in 6A while it is scanning.
- **Timing.**
  - 200–600 ms per step, easing `cubic-bezier(.2,.7,.2,1)`.
  - Number counters take 900 ms.
  - A whole sequence finishes within 2.5 s.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, show the final state instantly.
- **Performance.**
  - Animate only `transform` and `opacity`.
  - No layout thrash.
  - Total JS under 60 KB gzipped.
  - No libraries over 30 KB.
- **No scroll-jacking.** Normal scrolling always works; scroll stories use sticky positioning plus progress, not wheel capture.

---

## 5. Page list after the rebuild
`/` · `/manufacturers` · `/kazakhstan` (new) · `/partners` · `/sample` (new) · `/call`, which redirects to the booking page (Calendly for now) · `404.html`.

---

## 6. "See for yourself": interactive pieces

Build them in this order. 6A is the centrepiece.

### 6A. Register scan: "Is your molecule open in Kazakhstan?"
- **What the visitor does:** picks a molecule from a searchable list (the 14 in `kz_demo_molecules.json`) or clicks one of four chips.
- **What happens:**
  1. A results card opens with a thin blue scan line sweeping across a faint grid of register rows (about 1.2 s).
  2. Counters tick up: brands registered, manufacturers registered, brands on the shelf, and the leader's pharmacies out of 1,340.
  3. A horizontal stacked bar fills by maker origin: Kazakhstan and EAEU, India, Pakistan, Western Europe and US, Central Europe, Turkey, Other.
  4. A verdict chip lands last: **Crowded** (grey), **Thin** (blue-soft) or **Open** (blue), with one sentence.
- **Verdict sentences:**
  - Crowded: "Seven or more brands, or two or more South Asian makers. Hard to win on price."
  - Thin: "A few brands. Room for a well-priced second source."
  - Open: "One brand or none registered. Worth a closer look."
- **Under the result:** "This is one molecule. We run this for every product in your catalogue, against the register, 1,340 pharmacy shelves and the state purchase list." Button: "Send your product list".
- **If the molecule is not in the list:** "We have this for every molecule. Send it to us." The input is prefilled into a mailto: or WhatsApp link.
- **Footnote:** "Kazakhstan national register (live) and shelves of 1,340 pharmacies, November 2026."
- **Data:** `kz_demo_molecules.json`. It already excludes every molecule Nazryx has pitched to a client. Do not add molecules without Omar's approval; the data is real and the gaps are commercially sensitive.

### 6B. "From your catalogue to a plan" (scroll story on /manufacturers)
- A sticky panel on the left, with steps on the right.
- **Dots:** 120 small dots in a grid, each dot a product. This is an illustrative catalogue; label it "Illustrative, based on a 2026 screen".
- **Steps.** As the visitor scrolls, dots fade out in four steps, each with a counter and one line:
  1. "Made in your own plant": 120 → 96
  2. "Checked against the national register": 96 → 40
  3. "Checked against 1,340 pharmacy shelves and the state purchase list": 40 → 18
  4. "Ready to file or worth a bioequivalence study": 18 → 15
- **Waves:** the remaining 15 dots slide into four columns labelled Wave 1A, 1B, 2A and 2B, with "first sales 2028–2030".
- **Final frame:** "15 products · 4 filing waves · registrations in your name."
- **Rule:** use these round illustrative numbers. Never real client numbers or names.

### 6C. Registration route toggle (/manufacturers and /kazakhstan)
- Two tabs: **National route** | **EAEU route**.
- An animated Gantt bar on a 2027–2030 axis:
  - **National:** file Q2 2027 → expertise up to 100 working days → first sales 2028. A red marker labelled "National window closes 31 Dec 2027".
  - **EAEU:** file 2027–28 → 140 working days plus answers (12–18 months) → first sales 2029. A side note: "Extendable to Russia, Belarus, Armenia, Kyrgyzstan".
- Below the bars: "We choose the route per product. Quick products go national for 2028 sales; products that need a bioequivalence study go EAEU."

### 6D. Price position by producer country (/kazakhstan)
- A horizontal bar chart with the 8 values from section 1. Bars grow on scroll (600 ms, staggered by 60 ms).
- Hovering or tapping a bar highlights it. The visitor can choose "Your country" from a dropdown, and that bar turns `--blue` while the others stay `--blue-mid`.
- Caption: "Shelf price of the same medicine and dose, by producer country. India = 1.00. Kazakh pharmacies, November 2026."

### 6E. One dossier, four markets (/kazakhstan)
- A flat SVG map of Kazakhstan, Russia, Belarus, Armenia and Kyrgyzstan.
- Kazakhstan fills blue first and is labelled "Reference state". Thin animated lines then draw to the other four, which fill blue-soft one after another.
- Side table: country · people · route. Use only the figures on the current site's EAEU table that Omar confirms.

### 6F. Proof counters (home and /manufacturers)
- The figures from the proof strip count up once when they come into view.

### 6G. Sample product profile viewer (/manufacturers and /sample)
- Shows page 1 (Market) and page 2 (Plan) of an anonymised profile, built as HTML, not an image, with a tab or a flip.
- Numbered hotspots on each block (competitors, packs on sale, market structure, volume, registration, promotion). On hover or tap, a one-line note explains what the block tells the manufacturer.
- Waits for Omar's approved anonymised content; use a skeleton until then.

### 6H. Markets map (home, optional)
- A flat SVG world crop showing the 7 markets as blue dots.
- Arcs draw from source countries (Pakistan, Bangladesh, Turkey, Egypt, Europe, Korea) to the markets, one after another, over 2 s.
- Clicking a market shows a small card. Kazakhstan links to /kazakhstan.

---

## 7. Copy rules
- Short sentences, plain words, written for a busy export manager. Corporate and positive.
- Lead with what the visitor gets, then the proof.
- Use numbers from section 1 only. Write exact figures; never ranges invented on the page.
- One idea per section; at most 2 bullets per card on the service grids.

---

## 8. Technical and SEO
- **Per-page `<title>` and meta description:**
  - "Kazakhstan market entry for pharmaceutical manufacturers | Nazryx"
  - "Pharmaceutical export team for frontier markets | Nazryx"
  - and so on for each page.
- **Open Graph and Twitter image:** 1200×630, cream background, logo, and the line "Your export team for frontier markets". Today the preview shows only the favicon, which looks broken when the link is shared on WhatsApp or LinkedIn.
- **Assets:** a favicon set plus `site.webmanifest`, `sitemap.xml` and `robots.txt`.
- **Contact:**
  - Email in plain text.
  - `tel:` links on every phone number.
  - A WhatsApp link (`https://wa.me/447466253544`) on every page.
  - A LinkedIn company link in the footer.
- **`/call`** redirects (a Cloudflare redirect rule, or `_redirects`) to https://calendly.com/nazryx/meeting-with-omar.
- **Analytics:** keep the current cookieless analytics and the "No cookies" line.
- **Accessibility:**
  - colour contrast AA
  - focus rings
  - every demo works by keyboard
  - charts have text equivalents (an `aria-label` with the numbers)
- **Performance:** Lighthouse 95+ on mobile for Performance, Accessibility, Best practices and SEO. Fonts preloaded, images as AVIF or WebP, no layout shift.
- **Footer** (one line plus links):
  - "© 2026 Nazryx"
  - Home · Manufacturers · Kazakhstan · Distributors · Contact
  - phones, email, LinkedIn
  - "Anonymous analytics. No cookies. No IP addresses stored."

---

## 9. Done means
- [ ] Every number on the site appears in section 1, or has been confirmed by Omar.
- [ ] None of the "Never on the site" items appear. Run a search for each before finishing.
- [ ] No client, principal, prospect or distributor names anywhere.
- [ ] No street addresses and no legal entity names anywhere. The brand is "Nazryx" only.
- [ ] One light theme on every page, only `#1259E6` as the brand colour, no gradients, shadows or glows.
- [ ] The mobile header fits on one line at 390 px. No horizontal scroll at 360 px.
- [ ] 6A, 6B, 6C and 6D work by mouse, touch and keyboard, and show their final state with reduced motion.
- [ ] Lighthouse mobile scores are 95+ in all four categories.
- [ ] Link previews (Open Graph) show the new image.
- [ ] Screenshots of every page at 1440 px and 390 px posted for Omar's review before publishing.
- [ ] Nothing is published to Cloudflare until Omar says go.
