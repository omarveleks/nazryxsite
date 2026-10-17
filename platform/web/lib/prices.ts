import { fmtMoney } from './format';
import { countryName } from './mfr';

// A molecule's average price in a market (molecule_prices, built by ingest/pricing.py).
export type MoleculePrice = {
  molecule_id: number; country: string; basis: 'listings' | 'estimate'; kinds: string[]; currency: string; unit: string;
  strength: string | null; unit_price: string; unit_usd: string; lo: string | null; hi: string | null; n: number;
  from_country: string | null; factor: string | null; overlap: number | null;
  by_strength: { strength: string; unit: number; pack: number; n: number }[];
};

export const PRICE_SQL = `select molecule_id, country, basis, kinds, currency, unit, strength, unit_price, unit_usd, lo, hi, n,
  from_country, factor, overlap, by_strength from molecule_prices`;

const UNIT_SHORT: Record<string, string> = { 'tablet or capsule': 'tablet', 'ampoule or vial': 'vial', pack: 'pack' };
const KIND: Record<string, string> = { retail: 'pharmacy prices', cap: 'official maximum prices', reimbursement: 'reimbursement amounts', tender: 'public tender prices' };

export const perUnit = (p: MoleculePrice) => `${p.currency} ${fmtMoney(p.unit_price)} / ${UNIT_SHORT[p.unit] ?? p.unit}`;
export const usd = (v: string | number) => `$${Number(v) < 1 ? Number(v).toFixed(3) : fmtMoney(v)}`;

// Where the number comes from, in one line.
export function priceBasis(p: MoleculePrice) {
  const what = p.kinds.map((k) => KIND[k] ?? k).join(' and ');
  if (p.basis === 'listings') return `Average of ${p.n} ${p.n === 1 ? what.replace(/s\b/g, '') : what}${p.strength ? ` for ${p.strength}` : ''}.`;
  const adj = p.factor && Number(p.overlap ?? 0) >= 15
    ? `adjusted to ${countryName(p.country)}'s price level (${Number(p.factor) >= 1 ? '+' : ''}${Math.round((Number(p.factor) - 1) * 100)}%, from ${p.overlap} medicines priced in both)`
    : 'converted at today\'s exchange rate';
  return `Estimate: no price published in ${countryName(p.country)} yet, so ${countryName(p.from_country ?? '')}'s ${what}${p.strength ? ` for ${p.strength}` : ''}, ${adj}.`;
}
