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

export const unitShort = (p: MoleculePrice) => UNIT_SHORT[p.unit] ?? p.unit;
export const unitWord = (p: MoleculePrice) => `${p.strength ? `${p.strength} ` : ''}${unitShort(p)}`;
export const perUnit = (p: MoleculePrice) => `${p.currency} ${fmtMoney(p.unit_price)} / ${UNIT_SHORT[p.unit] ?? p.unit}`;
export const usd = (v: string | number) => `$${Number(v) < 1 ? Number(v).toFixed(3) : fmtMoney(v)}`;

// One plain line under the prices; sources stay with Nazryx.
export function priceBasis(p: MoleculePrice) {
  return p.basis === 'listings' ? `Based on ${p.n} ${p.n === 1 ? 'price' : 'prices'} in ${countryName(p.country)}.` : 'Estimated.';
}
