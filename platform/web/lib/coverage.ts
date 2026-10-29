// What we know about a market and how fresh it is, for the coverage page and the lines under each number. Honest by
// design: a thin market says so, and the page says what is being added.
import { one, rows, type Db } from './db';

export type Coverage = {
  registry: { products: number; active: number; molecules: number; companies: number; read_at: string | null; source: string | null };
  prices: { listings: number; sources: number; molecules: number; measured: number; thin: number; estimated: number; read_at: string | null; shops: number; official: number };
  tenders: { total: number; open: number; recent: number; read_at: string | null };
  regulatory: { requirements: number; routes: number; checked_at: string | null };
  partners: { distributors: number; companies: number };
  devices: { total: number };
  list: { molecules: number; open: number };
  trade: { years: number; latest_year: number | null; read_at: string | null };
};

export const DEPTH = {
  // what counts as deep, for the chips on the coverage page
  prices: (c: Coverage) => (c.prices.measured >= 100 && c.prices.shops >= 2 ? 'deep' : c.prices.measured >= 20 ? 'fair' : 'thin'),
  registry: (c: Coverage) => (c.registry.active >= 2000 ? 'deep' : c.registry.active >= 300 ? 'fair' : 'thin'),
  tenders: (c: Coverage) => (c.tenders.recent >= 50 ? 'deep' : c.tenders.recent >= 10 ? 'fair' : 'thin'),
  regulatory: (c: Coverage) => (c.regulatory.requirements >= 15 && c.regulatory.routes >= 2 ? 'deep' : c.regulatory.requirements >= 5 ? 'fair' : 'thin'),
  partners: (c: Coverage) => (Math.max(c.partners.distributors, c.partners.companies) >= 100 ? 'deep' : Math.max(c.partners.distributors, c.partners.companies) >= 20 ? 'fair' : 'thin'),
};
export const DEPTH_TONE: Record<string, string> = { deep: 'mint', fair: 'blue', thin: 'peach' };
export const DEPTH_LABEL: Record<string, string> = { deep: 'Deep', fair: 'Fair', thin: 'Thin' };

export async function coverage(db: Db, c: string): Promise<Coverage> {
  const reg = await one(db, `select count(*)::int as products, count(*) filter (where active)::int as active,
      count(distinct molecule_id) filter (where active)::int as molecules,
      count(distinct coalesce(ltr_id, registrant_id)) filter (where active)::int as companies from registrations where country = $1`, [c]);
  const regRead = await one(db, `select greatest((select max(finished_at) from registry_uploads where country = $1 and status = 'applied'),
      (select last_ok from data_sources where key = $2)) as read_at, (select label from data_sources where key = $2) as source`, [c, `registry_${c}`]);
  const pr = await one(db, `select (select count(*)::int from price_listings where country = $1 and molecule_id is not null) as listings,
      (select count(distinct source)::int from price_listings where country = $1 and molecule_id is not null) as sources,
      (select count(distinct source)::int from price_listings l where l.country = $1 and l.molecule_id is not null
         and exists (select 1 from price_source_labels s where s.source = l.source and s.label like '%pharmac%')) as shops,
      (select count(distinct source)::int from price_listings l where l.country = $1 and l.molecule_id is not null
         and exists (select 1 from price_source_labels s where s.source = l.source and s.public)) as official,
      (select count(*)::int from molecule_prices where country = $1) as molecules,
      (select count(*)::int from molecule_prices where country = $1 and confidence = 'measured') as measured,
      (select count(*)::int from molecule_prices where country = $1 and confidence = 'thin') as thin,
      (select count(*)::int from molecule_prices where country = $1 and confidence = 'estimated') as estimated,
      (select max(seen)::text from price_listings where country = $1) as read_at`, [c]);
  const te = await one(db, `select count(*)::int as total, count(*) filter (where stage = 'open')::int as open,
      count(*) filter (where coalesce(awarded, closing, published) > now() - interval '90 days')::int as recent,
      (select last_ok from data_sources where key = $2) as read_at from tenders where country = $1`, [c, `tenders_${c}`]);
  const rq = await one(db, `select (select count(*)::int from reg_requirements where country = $1 and status = 'published') as requirements,
      (select count(*)::int from country_routes where country = $1) as routes,
      (select max(checked)::text from reg_requirements where country = $1) as checked_at`, [c]);
  const pa = await one(db, `select (select count(distinct ltr_id)::int from registrations where country = $1 and active and ltr_id is not null) as distributors,
      (select count(distinct coalesce(ltr_id, registrant_id))::int from registrations where country = $1 and active) as companies`, [c]);
  const dv = await one(db, 'select count(*)::int as total from devices where country = $1 and active', [c]);
  const li = await one(db, `select count(*)::int as molecules, count(*) filter (where registrants = 0 and rankable)::int as open
      from country_molecules where country = $1 and on_national_list`, [c]);
  const tr = await one(db, `select count(distinct year)::int as years, max(year) filter (where value_usd is not null)::int as latest_year, max(read_at) as read_at
      from trade_flows where country = $1 and hs = '3004' and partner = '0'`, [c]);
  const iso = (v: any) => (v ? new Date(v).toISOString() : null);
  return {
    registry: { products: reg?.products ?? 0, active: reg?.active ?? 0, molecules: reg?.molecules ?? 0, companies: reg?.companies ?? 0, read_at: iso(regRead?.read_at), source: regRead?.source ?? null },
    prices: { listings: pr?.listings ?? 0, sources: pr?.sources ?? 0, shops: pr?.shops ?? 0, official: pr?.official ?? 0, molecules: pr?.molecules ?? 0,
      measured: pr?.measured ?? 0, thin: pr?.thin ?? 0, estimated: pr?.estimated ?? 0, read_at: iso(pr?.read_at) },
    tenders: { total: te?.total ?? 0, open: te?.open ?? 0, recent: te?.recent ?? 0, read_at: iso(te?.read_at) },
    regulatory: { requirements: rq?.requirements ?? 0, routes: rq?.routes ?? 0, checked_at: iso(rq?.checked_at) },
    partners: { distributors: pa?.distributors ?? 0, companies: pa?.companies ?? 0 },
    devices: { total: dv?.total ?? 0 },
    list: { molecules: li?.molecules ?? 0, open: li?.open ?? 0 },
    trade: { years: tr?.years ?? 0, latest_year: tr?.latest_year ?? null, read_at: iso(tr?.read_at) },
  };
}

/** One short line for a page header: "Register read 12 Oct · prices read 24 Oct". */
export function readLine(c: Coverage) {
  const d = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null);
  const parts = [c.registry.read_at ? `register read ${d(c.registry.read_at)}` : null, c.prices.read_at ? `prices read ${d(c.prices.read_at)}` : null,
    c.tenders.read_at ? `tenders read ${d(c.tenders.read_at)}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ').replace(/^./, (m) => m.toUpperCase()) : 'Not read yet';
}

/** Where the market gets deeper next, from what is thin; honest, and the same for every customer. */
export function nextUp(c: Coverage, market: string): string[] {
  const out: string[] = [];
  if (DEPTH.prices(c) !== 'deep') out.push(c.prices.shops < 2 ? 'More pharmacies are being read for prices.' : 'More products are being priced from the pharmacies we read.');
  if (DEPTH.tenders(c) === 'thin') out.push('Tender collection from the procurement portals is being widened.');
  if (DEPTH.regulatory(c) !== 'deep') out.push('The regulatory team is adding requirements and routes.');
  if (DEPTH.partners(c) === 'thin') out.push('Distributor profiles are being built from the register and import data.');
  void market;
  return out;
}
