import { fmtMoney } from './format';
import { countryName } from './mfr';

// A molecule's average price in a market (molecule_prices, built by ingest/pricing.py).
export type MoleculePrice = {
  molecule_id: number; country: string; basis: 'listings' | 'estimate'; kinds: string[]; currency: string; unit: string;
  strength: string | null; unit_price: string; unit_usd: string; lo: string | null; hi: string | null; n: number;
  from_country: string | null; factor: string | null; overlap: number | null;
  by_strength: { strength: string; unit: number; pack: number; n: number }[]; pack_size: string | null;
  generic_price: string | null; brand_price: string | null;   // per unit, local currency
  // the other forms it comes in (drops beside the usual capsules), per unit of that form
  forms?: Record<string, { basis: 'listings' | 'estimate'; strength: string | null; unit_price: number; unit_usd: number;
    lo: number; hi: number; n: number; pack_size: number | null }> | null;
};

export const PRICE_SQL = `select molecule_id, country, basis, kinds, currency, unit, strength, unit_price, unit_usd, lo, hi, n,
  from_country, factor, overlap, by_strength, pack_size, generic_price, brand_price, to_jsonb(molecule_prices) -> 'forms' as forms
  from molecule_prices`;

const UNIT_SHORT: Record<string, string> = { 'tablet or capsule': 'tablet', 'ampoule or vial': 'vial', inhaler: 'inhaler', pack: 'pack', ml: 'ml', g: 'g' };

// Drops, syrups and creams are compared per ml or g and shown per usual bottle or tube ('5 ml').
export const packOf = (p: MoleculePrice) => ((p.unit === 'ml' || p.unit === 'g') && p.pack_size ? Number(p.pack_size) : 1);
export const unitShort = (p: MoleculePrice) => UNIT_SHORT[p.unit] ?? p.unit;
export const unitWord = (p: MoleculePrice) => packOf(p) > 1 || p.unit === 'ml' || p.unit === 'g'
  ? `${fmtMoney(packOf(p))} ${p.unit}${p.strength ? ` (${p.strength}/${p.unit})` : ''}`
  : `${p.strength ? `${p.strength} ` : ''}${unitShort(p)}`;
export const perUnit = (p: MoleculePrice) => `${p.currency} ${fmtMoney(Number(p.unit_price) * packOf(p))} / ${packOf(p) > 1 ? `${fmtMoney(packOf(p))} ${p.unit}` : unitShort(p)}`;
export const usd = (v: string | number) => `$${Number(v) < 1 ? Number(v).toFixed(3) : fmtMoney(v)}`;

// One plain line under the prices; sources stay with Nazryx.
export function priceBasis(p: MoleculePrice) {
  return p.basis === 'listings' ? `Based on ${p.n} ${p.n === 1 ? 'price' : 'prices'} in ${countryName(p.country)}.` : 'Estimated.';
}

/** The unit a product is sold by, from its form; null when the form does not say. */
export function formUnit(form?: string | null) {
  const f = (form ?? '').toLowerCase();
  if (/inhaler|evohaler|accuhaler|turbuhaler|\bmdi\b|aerosol/.test(f) && !/solution|nebul/.test(f)) return 'inhaler';
  if (/tablet|capsule|caplet|lozenge|pastille|softgel|\bcaps?\b|\btabs?\b/.test(f)) return 'tablet or capsule';
  if (/inject|ampoule|ampule|vial|infusion|intraven|syringe/.test(f)) return 'ampoule or vial';
  if (/drop|syrup|solution|suspension|spray|gel|cream|ointment|liquid|inhal|aerosol|emulsion|lotion|powder/.test(f)) return 'ml';
  return null;
}
/** Whether a molecule's average price is for the same kind of product: a vial price is no guide to a capsule. */
export function priceFits(p: MoleculePrice, form?: string | null) {
  const u = formUnit(form);
  if (p.unit === 'pack') return false;          // a pack of unknown size: 10 tablets or 100?
  if (!u) return true;
  return u === 'ml' ? p.unit === 'ml' || p.unit === 'g' : p.unit === u;
}

/** The price for a product's own form: the headline when it fits, else the same medicine's price in that form (drops
 *  beside the usual capsules), or null when nothing near prices that form. */
export function priceFor(p: MoleculePrice | null | undefined, form?: string | null): MoleculePrice | null {
  if (!p) return null;
  if (priceFits(p, form) && p.unit !== 'pack') return p;     // a pack of unknown size says nothing: never shown
  const u = formUnit(form);
  const f = u ? (u === 'ml' ? p.forms?.ml ?? p.forms?.g : p.forms?.[u]) : null;
  if (!f) return null;
  return { ...p, basis: f.basis, unit: u === 'ml' && !p.forms?.ml ? 'g' : u!, strength: null, unit_price: String(f.unit_price),
    unit_usd: String(f.unit_usd), lo: String(f.lo), hi: String(f.hi), n: f.n, pack_size: f.pack_size == null ? null : String(f.pack_size),
    by_strength: [], generic_price: null, brand_price: null };
}

/** The middle of a list of numbers. */
export const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
