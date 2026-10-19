import 'server-only';
import { rows } from './db';
import { brandOf, inGroup } from './segments';

export type BrandRow = { brand: string; id?: number; medicine: number; device: number; deviceClass?: string | null; since?: number | null;
  origin: string | null; prices: { name: string; price: number; currency: string }[]; per10: number | null };

/** Millilitres or grams in a pack name ('Systane Ultra 10ml', '2 x 5 ml', '3.5g'); null when not stated. */
export function volume(name: string) {
  const m = name.toLowerCase().match(/(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(ml|mls|g|gm)\b/);
  return m ? (m[1] ? Number(m[1]) : 1) * Number(m[2].replace(',', '.')) : null;
}
/** Median price per 10 ml (or 10 g) across packs: compares a 10 ml bottle with a 15 ml one fairly. */
export function per10(prices: { name: string; price: number }[]) {
  const v = prices.map((p) => ({ v: volume(p.name), p: p.price })).filter((x) => x.v && x.v > 0).map((x) => (x.p / x.v!) * 10).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

// brands match whatever the spacing and hyphens: 'HYLO-COMOD' = 'Hylo Comod'
const key = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
const N = (col: string) => `regexp_replace(lower(${col}), '[^a-z0-9]', '', 'g')`;

/** For each watched brand: registered in this market (as a medicine or a device), and the pharmacy prices we found. */
export async function brandPresence(db: any, market: string, brands: { id: number; brand: string }[]): Promise<BrandRow[]> {
  const out: BrandRow[] = [];
  for (const b of brands) {
    const [med] = await rows(db, `select count(*)::int as n, min(reg_year) as since,
                                  string_agg(distinct initcap(lower(manufacturing_country)), ', ') as made from registrations
                                  where country = $1 and active and (${N('brand')} like '%' || $2 || '%')`, [market, key(b.brand)]);
    const [dev] = await rows(db, `select count(*)::int as n, min(reg_year) as since, max(risk_class) as cls,
                                  string_agg(distinct manufacturing_country, ', ') as made from devices
                                  where country = $1 and active and (${N('brand')} like '%' || $2 || '%' or ${N('manufacturer')} like '%' || $2 || '%')`, [market, key(b.brand)]);
    const prices = await rows(db, `select name, pack_price::float as price, currency from price_listings
                                   where country = $1 and ${N('name')} like '%' || $2 || '%' and kind = 'retail' order by pack_price limit 8`, [market, key(b.brand)]);
    out.push({ id: b.id, brand: b.brand, medicine: med.n, device: dev.n, deviceClass: dev.cls, since: med.since ?? dev.since,
      origin: [med.made, dev.made].filter(Boolean).join(', ') || null, prices, per10: per10(prices) });
  }
  return out;
}

/** Other brands in the same use group in this market, from the registers and pharmacy listings. */
export async function segmentBrands(db: any, market: string, group: string, skip: string[]) {
  const pre = 'eye|tear|nasal|nose|saline|sinus|visc|hyalur|ovd|articul|knee|joint|sea ?water|neti|lubric|systane|optive|refresh|sterimar|neilmed|contact lens|lens care|renu|opti-?free|biotrue|nebuli|hypertonic|filler';
  const listings = await rows(db, `select l.name, l.pack_price::float as price, l.currency, l.description, m.inn from price_listings l
                                   left join molecules m on m.id = l.molecule_id where l.country = $1 and l.kind = 'retail' and l.name ~* $2`, [market, pre]);
  const devs = await rows(db, `select brand, risk_class, manufacturer, manufacturing_country as made from devices where country = $1 and active and use_group = $2`, [market, group]);
  const meds = await rows(db, `select brand, generic_name, dosage_form, initcap(lower(manufacturing_country)) as made from registrations where country = $1 and active
                               and (brand || ' ' || coalesce(generic_name, '') || ' ' || coalesce(dosage_form, '')) ~* $2`, [market, pre]);
  const seen = new Map<string, { brand: string; registered: string | null; prices: number[]; currency: string; packs: string[]; names: string[]; made: Set<string> }>();
  const skipL = skip;
  const add = (brand: string, registered: string | null, price?: number, currency?: string, pack?: string, made?: string | null) => {
    const k = key(brand);
    if (!k || skipL.some((s) => k.includes(key(s)) || key(s).includes(k))) return;
    const x = seen.get(k) ?? { brand, registered: null, prices: [], currency: currency ?? '', packs: [], names: [], made: new Set<string>() };
    if (registered) x.registered = registered;
    if (made) x.made.add(made);
    if (price != null) { x.prices.push(price); x.names.push(pack ?? ''); x.currency = currency ?? x.currency; if (pack && x.packs.length < 3) x.packs.push(pack); }
    seen.set(k, x);
  };
  // a watched company's other product lines ('Nasamist' by NeilMed) are that brand, not another competitor
  for (const d of devs) if (!skipL.some((w) => key(d.manufacturer ?? '').includes(key(w)))) add(brandOf(d.brand), d.risk_class ? `Device, ${d.risk_class}` : 'Device', undefined, undefined, undefined, d.made);
  for (const m of meds) if (inGroup(group, `${m.brand} ${m.dosage_form ?? ''}`, m.generic_name)) add(brandOf(m.brand), 'Medicine', undefined, undefined, undefined, m.made);
  for (const l of listings) if (inGroup(group, l.name, l.inn, l.description)) add(brandOf(l.name), null, l.price, l.currency, l.name);
  // brands seen only in pharmacies: are they on a register under the same name?
  const onReg = new Map<string, string>();
  for (const d of devs) onReg.set(key(brandOf(d.brand)), d.risk_class ? `Device, ${d.risk_class}` : 'Device');
  for (const m of meds) if (!onReg.has(key(brandOf(m.brand)))) onReg.set(key(brandOf(m.brand)), 'Medicine');
  for (const x of seen.values()) if (!x.registered) x.registered = onReg.get(key(x.brand)) ?? null;
  return [...seen.values()].map((x) => ({ ...x, made: [...x.made].join(', ') || null, per10: per10(x.prices.map((p, i) => ({ name: x.names[i], price: p }))) })).sort((a, b) => b.prices.length - a.prices.length || Number(Boolean(b.registered)) - Number(Boolean(a.registered))).slice(0, 25);
}
