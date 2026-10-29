import { apiUser, json, marketOf } from '@/lib/api';
import { rows, withUser } from '@/lib/db';
import { PRICE_SQL } from '@/lib/prices';
export const dynamic = 'force-dynamic';
/** GET /api/v1/prices?market=TZ[&molecule=ID]: median shelf prices with sources, confidence and the daily history for one molecule. */
export async function GET(req: Request) {
  const a = await apiUser(req); if ('error' in a) return a.error;
  const m = marketOf(req, a.u); if (m instanceof Response) return m;
  const mol = Number(new URL(req.url).searchParams.get('molecule')) || null;
  const out = await withUser(a.u.id, async (db) => {
    const prices = await rows(db, `${PRICE_SQL} where country = $1 ${mol ? 'and molecule_id = $2' : ''} order by molecule_id ${mol ? '' : 'limit 2000'}`, mol ? [m, mol] : [m]);
    const inns = Object.fromEntries((await rows(db, 'select id, inn from molecules where id = any($1)', [prices.map((p) => p.molecule_id)])).map((r) => [r.id, r.inn]));
    const history = mol ? await rows(db, 'select day, unit, unit_price, unit_usd, confidence, n from price_history where country = $1 and molecule_id = $2 order by day', [m, mol]) : undefined;
    return { prices: prices.map((p) => ({ molecule_id: p.molecule_id, inn: inns[p.molecule_id], currency: p.currency, unit: p.unit, strength: p.strength, unit_price: p.unit_price, unit_usd: p.unit_usd,
      low: p.lo, high: p.hi, listings: p.n, basis: p.basis, confidence: p.confidence, sources: p.sources, read_at: p.read_at })), history };
  });
  return json({ market: m, ...out });
}
