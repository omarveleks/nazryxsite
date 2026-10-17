import { fmtMoney } from './format';
import { countryName } from './mfr';

// A molecule's average price in a market (molecule_prices, built by ingest/pricing.py).
export type MoleculePrice = {
  molecule_id: number; country: string; basis: 'listings' | 'estimate'; kinds: string[]; currency: string; unit: string;
  strength: string | null; unit_price: string; unit_usd: string; lo: string | null; hi: string | null; n: number;
  from_country: string | null; factor: string | null; overlap: number | null;
  by_strength: { strength: string; unit: number; pack: number; n: number }[]; pack_size: string | null;
};

export const PRICE_SQL = `select molecule_id, country, basis, kinds, currency, unit, strength, unit_price, unit_usd, lo, hi, n,
  from_country, factor, overlap, by_strength, pack_size from molecule_prices`;

const UNIT_SHORT: Record<string, string> = { 'tablet or capsule': 'tablet', 'ampoule or vial': 'vial', pack: 'pack', ml: 'ml', g: 'g' };

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
