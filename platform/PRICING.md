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
   An ampoule written as concentration and volume is its dose ('40 mg/ml 2 ml' is 80 mg). A shop's note on the box a
   unit comes in ('15 ml drop: ৳20 (12's pack: ৳240)') is ignored: it is no count of tablets.
3. **Evidence tiers.** Shelf prices and surveys first, then official maximums (scaled by how shelf prices compare
   with maximums where both are known), then reimbursement, then tenders. A market uses only its best tier.
4. **Sanity.** Each price is checked against the same medicine, form and strength in other countries after allowing
   for each country's price level. A tablet or vial pack priced over 8x too low, whose price would be right for one
   unit, is read as one unit (a cheap generic pack is often really that cheap, and a bottle is never one ml); anything
   still over 8x off is dropped.
5. **One voice per brand.** A market's price is the median over its products, each brand once at its median across
   shops, so a brand stocked by every shop does not outvote the rest. An ingredient-named listing ('Ceftriaxone 1g',
   'Цефтриаксона натриевая соль') is the generic; one that names a brand further on is that brand.
6. **One form and strength to compare.** The headline is the form and strength most countries sell (tablets count
   double), so markets compare like for like. Every other form a medicine comes in gets its own price beside it
   (vitamin D3 drops beside its capsules), and a product is shown the price for its own form. Ties are broken the
   same way every run, so the same data always gives the same prices.

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
its eye and nasal drops 5-7x (South Asia caps their prices); Tanzania's eye drops are about 2x South Asia and 0.29x
Kenya; Nigeria's tablets are 2-2.4x South Asia and about 0.63x Kenya. Kazakhstan is about 1.4x Kyrgyzstan and 1.55x
Uzbekistan; Kyrgyzstan about 0.76x Uzbekistan.

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

October 2026. Basket: 31 medicines in every form (tablets, injections, eye and nasal drops, creams, inhalers,
combinations), 1,414 shelf and official prices read by hand from all six markets and South Asia. Each market's own
prices were hidden in turn and its prices estimated from its neighbours alone, then compared with its real ones,
medicine by medicine.

| Market | Medicines tested | Typical error before → after | Within 50% before → after | Bias before → after |
|---|---|---|---|---|
| Kenya | 21 | 47% → 57% | 52% → 48% | 0.72 → 0.69 |
| Kyrgyzstan | 17 | 48% → 38% | 53% → 65% | 1.43 → 1.16 |
| Kazakhstan | 18 | 62% → 65% | 39% → 44% | 0.63 → 0.93 |
| Nigeria | 27 → 29 | 58% → 41% | 48% → 52% | 1.25 → 1.06 |
| Tanzania | 13 | not tested before → 43% | → 54% | → 1.05 |
| Uzbekistan | 21 | 80% → 62% | 29% → 33% | 1.73 → 1.17 |

The check after every rebuild (Admin, 'Accuracy': only the medicine's own shelf hidden, gaps measured) on the same
data: Nigeria 0.48 → 0.35, Kazakhstan 0.81 → 0.44, Uzbekistan 0.65 → 0.53, Kyrgyzstan 0.80 → 0.57, Tanzania 0.43,
Kenya 0.59 → 0.67 (typical error; Kenya's is the brand mix below).

Bias is the estimate over the real price (1.0 is right on the whole). This is the hardest test: with a market's own
prices hidden, its measured gaps go too. On the pages a market's few own shelf prices count double, and gaps are
measured from the live data.

What was wrong, and what changed:

- **No price gaps inside Central Asia.** Kazakhstan, Kyrgyzstan and Uzbekistan carried each other's prices over at
  1.0, so Uzbekistan's estimates ran 1.7x high and Kazakhstan's 0.6x low. Gaps set from the basket (074).
- **Kenya's and Tanzania's nasal drops** used the old 1.4-1.9x 'as eye drops' gaps after eye drops were re-measured at
  5-7x. Now as eye drops (074). Kenya's and Nigeria's nasal shelves are mostly one originator brand at 10-60x South
  Asia's generics: two medicines are too few to set a nasal gap of their own, so Kenya's nasal estimates still run low.
- **Nigeria's tablet gaps** with Kenya (1.0) and Pakistan (3.2) were 0.63 and 1.9 on the basket (074).
- **MedEx box notes saved as prices.** '(12's pack: ৳240)' was saved as one 'tablet' of nasal drops at the price of
  twelve bottles, and '(5 x 5: ৳350)' as one ampoule at the price of 25. Xylometazoline drops got a tablet headline.
  The reader skips them and the stored ones were deleted (074).
- **A pack price read as one tablet too readily.** Any shop pack under a quarter of the expected price was re-read as
  one tablet: real cheap generics (Nigeria's ₦50 prednisolone 10-packs) became ₦50 a tablet, and a ৳20 bottle of 15 ml
  became ৳20 a ml. Now only tablets and vials, only over 8x too low, and only when one unit would be the right price.
- **Ampoule doses.** '2 мг/мл 2мл' was read as 2 mg, beside '4 мг/2 мл' at 4 mg: one ampoule as two strengths.
- **Prices changed between runs on the same data.** Tied votes for the form and strength went by the order of a set,
  which changes with each process (Kyrgyzstan's ondansetron came out at 20 or 68 KGS). Ties now go the same way.
- **Inflected names** ('Цефтриаксона натриевая соль') were counted as a brand of their own.
- **Tanzanian labels.** '100mils' and '10mls' were not read as a size, so 13% of the Tanzanian pharmacy's products
  (syrups, drops, suspensions) had no price per ml and were never shown; 'Gofen 400 Capsules - 10's' was read as 400
  capsules (a price 40x too low); 'tablets10s' was not read as 10.
- **Tanzania had no shelf check.** It has one now (75 prices, 25 medicines). Its cheap chronic-disease generics
  (amlodipine, metformin, losartan at TZS 10-130 a tablet) are far below Kenya's: estimates from its neighbours run
  high for them and right for antibiotics, injections and creams.

What is right and stays: most remaining misses are real. Kenya's shelf for cetirizine, ibuprofen and diclofenac is
mostly originator brands at 5-10x the generics South Asia sells, so estimates from South Asia run low (bias 0.72);
raising Kenya's gaps to match moved the error to its generic-heavy medicines (typical error 69%) and was not kept.
Kazakhstan's maximum price for some injections (ondansetron) is below its neighbours', against the overall gap. The
gaps above were set from the same basket they were tested on, so the next check, on a fresh basket, is their real test.
