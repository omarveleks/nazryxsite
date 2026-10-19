import 'server-only';
import { rows } from './db';
import { brandOf, inGroup } from './segments';

export type BrandRow = { brand: string; id?: number; medicine: number; device: number; deviceClass?: string | null; since?: number | null;
  prices: { name: string; price: number; currency: string }[] };

// brands match whatever the spacing and hyphens: 'HYLO-COMOD' = 'Hylo Comod'
const key = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
const N = (col: string) => `regexp_replace(lower(${col}), '[^a-z0-9]', '', 'g')`;

/** For each watched brand: registered in this market (as a medicine or a device), and the pharmacy prices we found. */
export async function brandPresence(db: any, market: string, brands: { id: number; brand: string }[]): Promise<BrandRow[]> {
  const out: BrandRow[] = [];
  for (const b of brands) {
    const [med] = await rows(db, `select count(*)::int as n, min(reg_year) as since from registrations
                                  where country = $1 and active and (${N('brand')} like '%' || $2 || '%')`, [market, key(b.brand)]);
    const [dev] = await rows(db, `select count(*)::int as n, min(reg_year) as since, max(risk_class) as cls from devices
                                  where country = $1 and active and (${N('brand')} like '%' || $2 || '%' or ${N('manufacturer')} like '%' || $2 || '%')`, [market, key(b.brand)]);
    const prices = await rows(db, `select name, pack_price::float as price, currency from price_listings
                                   where country = $1 and ${N('name')} like '%' || $2 || '%' and kind = 'retail' order by pack_price limit 8`, [market, key(b.brand)]);
    out.push({ id: b.id, brand: b.brand, medicine: med.n, device: dev.n, deviceClass: dev.cls, since: med.since ?? dev.since, prices });
  }
  return out;
}

/** Other brands in the same use group in this market, from the registers and pharmacy listings. */
export async function segmentBrands(db: any, market: string, group: string, skip: string[]) {
  const pre = 'eye|tear|nasal|nose|saline|sinus|visc|hyalur|ovd|articul|knee|joint|sea ?water|neti|lubric|systane|optive|refresh|sterimar|neilmed';
  const listings = await rows(db, `select l.name, l.pack_price::float as price, l.currency, l.description, m.inn from price_listings l
                                   left join molecules m on m.id = l.molecule_id where l.country = $1 and l.kind = 'retail' and l.name ~* $2`, [market, pre]);
  const devs = await rows(db, `select brand, risk_class from devices where country = $1 and active and use_group = $2`, [market, group]);
  const meds = await rows(db, `select brand, generic_name, dosage_form from registrations where country = $1 and active
                               and (brand || ' ' || coalesce(generic_name, '') || ' ' || coalesce(dosage_form, '')) ~* $2`, [market, pre]);
  const seen = new Map<string, { brand: string; registered: string | null; prices: number[]; currency: string; packs: string[] }>();
  const skipL = skip.map((s) => s.toLowerCase());
  const add = (brand: string, registered: string | null, price?: number, currency?: string, pack?: string) => {
    const k = brand.toLowerCase();
    if (!k || skipL.some((s) => k.includes(s) || s.includes(k))) return;
    const x = seen.get(k) ?? { brand, registered: null, prices: [], currency: currency ?? '', packs: [] };
    if (registered) x.registered = registered;
    if (price != null) { x.prices.push(price); x.currency = currency ?? x.currency; if (pack && x.packs.length < 3) x.packs.push(pack); }
    seen.set(k, x);
  };
  for (const d of devs) add(brandOf(d.brand), d.risk_class ? `Device, ${d.risk_class}` : 'Device');
  for (const m of meds) if (inGroup(group, `${m.brand} ${m.dosage_form ?? ''}`, m.generic_name)) add(brandOf(m.brand), 'Medicine');
  for (const l of listings) if (inGroup(group, l.name, l.inn, l.description)) add(brandOf(l.name), null, l.price, l.currency, l.name);
  // brands seen only in pharmacies: are they on a register under the same name?
  const onReg = new Map<string, string>();
  for (const d of devs) onReg.set(key(brandOf(d.brand)), d.risk_class ? `Device, ${d.risk_class}` : 'Device');
  for (const m of meds) if (!onReg.has(key(brandOf(m.brand)))) onReg.set(key(brandOf(m.brand)), 'Medicine');
  for (const x of seen.values()) if (!x.registered) x.registered = onReg.get(key(x.brand)) ?? null;
  return [...seen.values()].sort((a, b) => b.prices.length - a.prices.length || Number(Boolean(b.registered)) - Number(Boolean(a.registered))).slice(0, 25);
}
