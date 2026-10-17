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

// Reference countries used for the third tier (official price lists abroad).
const ABROAD: Record<string, string> = { PK: 'Pakistan', GB: 'the UK', FR: 'France' };
const UNIT_SHORT: Record<string, string> = { 'tablet or capsule': 'tablet', 'ampoule or vial': 'vial', pack: 'pack' };
const KIND: Record<string, string> = { retail: 'pharmacy prices', cap: 'official maximum prices', reimbursement: 'reimbursement amounts', tender: 'public tender prices' };

export const unitShort = (p: MoleculePrice) => UNIT_SHORT[p.unit] ?? p.unit;
export const unitWord = (p: MoleculePrice) => `${p.strength ? `${p.strength} ` : ''}${unitShort(p)}`;
export const perUnit = (p: MoleculePrice) => `${p.currency} ${fmtMoney(p.unit_price)} / ${UNIT_SHORT[p.unit] ?? p.unit}`;
export const usd = (v: string | number) => `$${Number(v) < 1 ? Number(v).toFixed(3) : fmtMoney(v)}`;

// Where the number comes from, in one plain sentence.
export function priceBasis(p: MoleculePrice) {
  const what = p.kinds.map((k) => KIND[k] ?? k).join(' and ');
  const here = countryName(p.country);
  if (p.basis === 'listings') return `From ${p.n} ${p.n === 1 ? what.replace(/s\b/g, '') : what} in ${here}. Low and premium are the cheapest and dearest tenth.`;
  const gap = Number(p.factor ?? 1);
  const adj = Math.abs(gap - 1) < 0.005 ? '' : `, adjusted for the usual price gap (${here} is ${Math.round(Math.abs(gap - 1) * 100)}% ${gap > 1 ? 'higher' : 'lower'})`;
  if (p.kinds.includes('ingredients')) return `Estimated from the prices of its ${p.n} ingredients in ${here}: combination packs usually cost about ${Math.round(gap * 100)}% of their ingredients bought separately (measured on ${p.overlap} combinations).`;
  const abroad = ABROAD[p.from_country ?? ''];
  return abroad
    ? `Estimated from ${abroad}'s official prices${adj}. No price is published for it in ${here} or nearby markets yet.`
    : `Estimated from ${p.n} ${what} in ${countryName(p.from_country)}${adj}. No public price in ${here} yet.`;
}
