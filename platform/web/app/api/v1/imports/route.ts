import { apiUser, json, marketOf } from '@/lib/api';
import { rows, withUser } from '@/lib/db';
export const dynamic = 'force-dynamic';
/** GET /api/v1/imports?market=TZ: medicine imports the country reported to UN Comtrade (HS 3003, 3004 and HS6 lines), by year and origin. */
export async function GET(req: Request) {
  const a = await apiUser(req); if ('error' in a) return a.error;
  const m = marketOf(req, a.u); if (m instanceof Response) return m;
  const list = await withUser(a.u.id, (db) => rows(db, `select year, hs, partner, partner_name, partner_iso, value_usd, kg, source, read_at from trade_flows where country = $1 and value_usd is not null order by year, hs, value_usd desc`, [m]));
  return json({ market: m, count: list.length, flows: list });
}
