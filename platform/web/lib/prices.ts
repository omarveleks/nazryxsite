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
  // where it comes from and how sure we are: the sources behind it (a shop key, a register, or 'market:KE' for a
  // neighbour an estimate rests on), the newest reading, and measured / thin / estimated
  sources?: { source: string; n: number }[] | null; read_at?: string | null; confidence?: Confidence;
};
export type Confidence = 'measured' | 'thin' | 'estimated';

export const PRICE_SQL = `select molecule_id, country, basis, kinds, currency, unit, strength, unit_price, unit_usd, lo, hi, n,
  from_country, factor, overlap, by_strength, pack_size, generic_price, brand_price, to_jsonb(molecule_prices) -> 'forms' as forms,
  to_jsonb(molecule_prices) -> 'sources' as sources, (to_jsonb(molecule_prices) ->> 'read_at') as read_at,
  coalesce(to_jsonb(molecule_prices) ->> 'confidence', case when basis = 'listings' then 'thin' else 'estimated' end) as confidence
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

/** What kind of source a reader is, for the basis line; shop names stay with Nazryx, public registers are named. */
export const SOURCE_KIND: Record<string, string> = {
  mydawa: 'pharmacy', pharmaplus: 'pharmacy', goodlife: 'pharmacy', afyadepo: 'pharmacy', dawazetu: 'pharmacy', europharma: 'pharmacy',
  biosfera: 'pharmacy', bimed: 'pharmacy', liki: 'pharmacy', bonamour: 'pharmacy', asset: 'pharmacy', mariamgrey: 'pharmacy', drugstore: 'pharmacy',
  healthplus: 'pharmacy', precious: 'pharmacy', medplus: 'pharmacy', medex: 'pharmacy', '1mg': 'pharmacy', dawaai: 'pharmacy',
  ppra: 'the national price survey', 'prices_KZ (NDDA)': 'the national maximum-price list', dlsmi: 'the national maximum-price list',
  reference: 'the national reference-price list', tender: 'public tender awards',
};
const readOn = (d?: string | null) => (d ? ` Read ${new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : '');

/** One plain line under the prices: what it rests on and when it was read. */
export function priceBasis(p: MoleculePrice) {
  const src = p.sources ?? [];
  if (p.basis === 'listings') {
    const shops = src.filter((s) => SOURCE_KIND[s.source] === 'pharmacy').length;
    const official = src.filter((s) => SOURCE_KIND[s.source] && SOURCE_KIND[s.source] !== 'pharmacy').map((s) => SOURCE_KIND[s.source]);
    const parts = [shops ? `${shops} ${shops === 1 ? 'pharmacy' : 'pharmacies'}` : '', ...[...new Set(official)]].filter(Boolean);
    return `Median of ${p.n} ${p.n === 1 ? 'price' : 'prices'} in ${countryName(p.country)}${parts.length ? ` from ${parts.join(' and ')}` : ''}.${readOn(p.read_at)}`;
  }
  const from = src.filter((s) => s.source.startsWith('market:')).map((s) => countryName(s.source.slice(7)));
  return `Estimated from ${from.length ? `${from.length === 1 ? 'one neighbouring market' : `${from.length} neighbouring markets`}` : 'neighbouring markets'}, adjusted for ${countryName(p.country)}'s price level. No shelf price read here yet.${readOn(p.read_at)}`;
}

/** The confidence word and its meaning, for the chip and its title. */
export const CONFIDENCE: Record<Confidence, { label: string; tone: string; title: string }> = {
  measured: { label: 'Measured', tone: 'mint', title: 'Three or more products from two or more sources, read in this market' },
  thin: { label: 'Thin', tone: 'peach', title: 'Read in this market, but from one source or fewer than three products' },
  estimated: { label: 'Estimated', tone: 'lav', title: 'No shelf price read here: carried over from neighbouring markets' },
};

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
  return { ...p, basis: f.basis, confidence: f.basis === 'listings' ? (f.n >= 3 ? 'measured' : 'thin') : 'estimated',
    unit: u === 'ml' && !p.forms?.ml ? 'g' : u!, strength: null, unit_price: String(f.unit_price),
    unit_usd: String(f.unit_usd), lo: String(f.lo), hi: String(f.hi), n: f.n, pack_size: f.pack_size == null ? null : String(f.pack_size),
    by_strength: [], generic_price: null, brand_price: null };
}

/** The middle of a list of numbers. */
export const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Each market's currency, for shelf prices shown in local money. */
export const MARKET_CURRENCY: Record<string, string> = { KZ: 'KZT', KG: 'KGS', UZ: 'UZS', KE: 'KES', TZ: 'TZS', NG: 'NGN', GH: 'GHS', SN: 'XOF', CI: 'XOF', CM: 'XAF',
  ET: 'ETB', UG: 'UGX', AZ: 'AZN', AM: 'AMD', BY: 'BYN' };

/** Where a price can be borrowed from when a market has none read yet, nearest first. A far market says little. */
export const NEIGHBOURS: Record<string, string[]> = {
  TZ: ['KE', 'UG', 'NG', 'GH'], KE: ['TZ', 'UG', 'NG', 'GH'], UG: ['KE', 'TZ', 'ET'], ET: ['KE', 'UG', 'TZ'], NG: ['GH', 'KE', 'TZ', 'SN'], GH: ['NG', 'SN', 'CI', 'KE'],
  SN: ['CI', 'CM', 'GH', 'NG'], CI: ['SN', 'CM', 'GH', 'NG'], CM: ['CI', 'SN', 'NG', 'GH'],
  KZ: ['KG', 'UZ', 'BY'], KG: ['KZ', 'UZ'], UZ: ['KZ', 'KG'], BY: ['KZ', 'AM', 'AZ'], AM: ['AZ', 'BY', 'KZ'], AZ: ['AM', 'BY', 'KZ'],
};

/** What a pack of this form is counted in, with a usual size: tablets per box, ml per bottle, vials per box. */
export function packKind(form?: string | null): { label: string; unit: string; size: number; liquid: boolean } {
  const f = (form ?? '').toLowerCase();
  const u = formUnit(form);
  if (u === 'tablet or capsule') return { label: 'Tablets or capsules per pack', unit: 'tablets', size: 30, liquid: false };
  if (u === 'ampoule or vial') return { label: 'Vials or ampoules per pack', unit: 'vials', size: 10, liquid: false };
  if (u === 'inhaler') return { label: 'Inhalers per pack', unit: 'inhalers', size: 1, liquid: false };
  if (u === 'ml') {
    if (/cream|ointment|gel|lotion|paste/.test(f)) return { label: 'Grams per tube', unit: 'g', size: 30, liquid: true };
    if (/drop|ophthalm|eye|ear|nasal|spray/.test(f)) return { label: 'ml per bottle', unit: 'ml', size: 5, liquid: true };
    if (/sachet|powder/.test(f)) return { label: 'Grams per sachet or tin', unit: 'g', size: 100, liquid: true };
    return { label: 'ml per bottle', unit: 'ml', size: 100, liquid: true };
  }
  return { label: 'Units per pack', unit: 'units', size: 30, liquid: false };
}
