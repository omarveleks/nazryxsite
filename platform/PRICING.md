# Pricing and classification framework

How the platform prices every medicine in every market, how it classes products, and how both are checked.
The code is the authority: `ingest/pricing.py` (prices), `ingest/price_checks.py` (checks), `ingest/classify.py`
(therapeutic classes), `ingest/devices.py` (device groups), `ingest/catalogue.py` (matching products to molecules),
`web/lib/prices.ts` and `web/lib/mfr.ts` (what the pages show).

## 1. Markets and the countries they borrow from

| Market | Its own prices | Neighbours (estimates borrow from these only) |
|---|---|---|
| Kazakhstan | NDDA maximum prices, Europharma pharmacy chain | Kyrgyzstan, Uzbekistan, Belarus, Armenia, Azerbaijan |
| Kyrgyzstan | bimed.kg pharmacy catalogue, DLSMI maximum prices | Kazakhstan, Uzbekistan, Belarus, Armenia, Azerbaijan |
| Uzbekistan | official reference and maximum prices | Kazakhstan, Kyrgyzstan, Belarus, Armenia, Azerbaijan |
| Kenya | PPRA price survey, MyDawa pharmacy | Tanzania, Nigeria, Pakistan, India, Bangladesh |
| Tanzania | AfyaDepot pharmacy | Kenya, Nigeria, Pakistan, India, Bangladesh |
| Nigeria | seven pharmacies (Bonamour, Asset, Mariam Grey, drugstore.ng, HealthPlus, Precious, MedPlus) | Ghana, Kenya, Tanzania, Pakistan, India, Bangladesh |

South Asia (MedEx Bangladesh, 1mg India, dawaai Pakistan) is where East Africa's generics are made, so its prices
carry over to Kenya, Tanzania and Nigeria. Central Asia never borrows from Africa or South Asia, nor the reverse.
Europe (UK Drug Tariff, France BDPM) is read but never priced into a market: originator prices say nothing about
an emerging market's shelf.

## 2. From a listing to a price per unit

1. **Every listing is matched to a molecule** (English, Russian or Latin spellings, salts dropped, vitamins by their
   ingredient names; `family()` and `word_key()`).
2. **Units.** A counted pack is priced per tablet, capsule, ampoule or vial ('№20', '20x10' strips, '30s').
   Drops, syrups, creams and gels are priced per ml or g. A bottle's size is not its strength (5 ml of 0.09% drops).
3. **Evidence tiers.** Shelf prices and surveys first, then official maximums (scaled by how shelf prices compare
   with maximums where both are known), then reimbursement, then tenders. A market uses only its best tier.
4. **Sanity.** Each price is checked against the same medicine, form and strength in other countries after allowing
   for each country's price level. A pack price far too low is read as one tablet; anything still over 8x off is dropped.
5. **One form and strength to compare.** The headline is the form and strength most countries sell (tablets count
   double), so markets compare like for like. Every other form a medicine comes in gets its own price beside it
   (vitamin D3 drops beside its capsules), and a product is shown the price for its own form.

## 3. A market's price

- **Three or more shelf prices** for the form and strength: their median is the market's price ("listings"),
  with the 10th and 90th percentiles as low and high.
- **Fewer:** an estimate. The market's own shelf price counts as two voices; each neighbour that prices the medicine
  is one voice, carried over by the price gap for that kind of product; the price is the median of the voices.
  A neighbour's single shelf price is a voice too.
- **Combinations nobody prices** are their ingredients added up, scaled by how combination packs compare with their
  ingredients where both are known.
- **Nothing in the market or its neighbours:** no price. The page says so and offers a check by the team. A price
  from far away is never shown.

## 4. Price gaps

The gap is how a market's prices compare with a neighbour's for one kind of product: tablets, injections, eye drops,
nasal, inhaled, topical, oral liquids (and all products together).

1. **Measured** from our own data when at least 10 medicines of that kind are priced in both countries (median ratio).
2. Else **set by hand** from a hands-on check of shelf prices (Admin shows each one with how many medicines it rests on).
3. Else the **set all-products gap** for the pair, else 1.0 (flagged as "no gap known").

Measured on real shelves in October 2026: Kenya's tablets are 2.1-2.8x South Asia and its injections about 1x;
its eye drops 5-7x (South Asia caps eye-drop prices); Tanzania's eye drops are about 2x South Asia and 0.29x Kenya;
Nigeria sits near Kenya for tablets, at 2-3x South Asia.

## 5. What the pages show

- One price per product: "Est. avg", in the market's currency, per pack (tablets per pack, drops per usual bottle).
- Low, average and high tiles when they differ; one average when they are the same.
- Never the country an estimate came from, never a brand-only price, never a price from outside the region.

## 6. Classes

- **Kind:** medicine, device or supplement, as the manufacturer files it (a catalogue's type column wins).
- **Use group** for device-like products: eye lubricants, nasal and inhaled saline, joint injections, eye-surgery
  viscoelastics, dermal fillers, contact-lens care. An eye or nasal drop with a medicine in it is a medicine.
- **Therapeutic class** of a molecule from its ATC codes and the forms it is registered in (`classify.py`). A product
  used in the eye, ear or nose, or breathed in, is shown the class of that use (dexamethasone eye drops are
  ophthalmological though dexamethasone is mostly tablets).
- **Products to molecules:** ingredient names first ('Etoricoxib-60' is etoricoxib), then the brand: our registers and
  pharmacy shelves, then MedEx. What cannot be matched waits in Admin with the reason and a box to match it.

## 7. Checks (automated, after every price rebuild)

Admin > Data > Price and class checks.

| Check | What it means | Threshold |
|---|---|---|
| Accuracy | Where a market's shelf price is known, the estimate from its neighbours alone against it: typical error, share within 50%, bias, per market and product type | 3+ shelf prices |
| Outlier | A shelf price far from what its neighbours say: one is wrong, or the market differs | over 3x either way |
| Implausible | A unit price no medicine has | tablet $0.0005-40, vial $0.01-800, ml or g $0.0005-60 |
| Wide range | Highest over lowest price for one form and strength | over 15x |
| Single source | An estimate resting on one country | |
| No gap | An estimate where no gap is known for that pair and product type | |
| No price | Portfolio products with no price for their form, per market | |
| Stale rate | An exchange rate not updated | over 3 days |
| Classes | Device with a medicine ingredient; supplement whose ingredient is a medicine (unless its label says supplement); medicine whose name says supplement; medicine sold as a device in most markets; medicine with no class | |

## 8. Manual checks

Every few months, and after any change to the rules: a basket of common medicines in every form, read by hand from
each market's shelves, run through the model with the market's own prices hidden, compared line by line; set gaps
are corrected where the hands-on check disagrees. The latest is below.

### Latest manual check

(filled in by the October 2026 check)
