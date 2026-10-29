import { apiUser, json } from '@/lib/api';
import { rows, withUser } from '@/lib/db';
export const dynamic = 'force-dynamic';
/** GET /api/v1/markets: the markets in the plan, with what we hold on each. */
export async function GET(req: Request) {
  const a = await apiUser(req); if ('error' in a) return a.error;
  const list = await withUser(a.u.id, (db) => rows(db, `select k.code, k.name, k.currency,
      (select count(*)::int from registrations r where r.country = k.code and r.active) as registrations,
      (select count(*)::int from molecule_prices p where p.country = k.code) as priced_molecules,
      (select count(*)::int from tenders t where t.country = k.code) as tenders,
      (select max(seen)::text from price_listings l where l.country = k.code) as prices_read_at
      from countries k where k.code = any($1) order by k.code`, [a.u.markets]));
  return json({ markets: list });
}
