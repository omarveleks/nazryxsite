import { apiUser, json, marketOf } from '@/lib/api';
import { rows, withUser } from '@/lib/db';
import { finderParams } from '@/lib/finder';
export const dynamic = 'force-dynamic';
/** GET /api/v1/molecules?market=TZ[&category=&max=&demand=&essential=1&form=&price=&q=]: every molecule in a market with
 *  competition, demand, essential-list status and the median price. The same filters as Opportunities. */
export async function GET(req: Request) {
  const a = await apiUser(req); if ('error' in a) return a.error;
  const m = marketOf(req, a.u); if (m instanceof Response) return m;
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const p = finderParams(sp);
  const q = (sp.q ?? '').slice(0, 60).toLowerCase();
  const list = await withUser(a.u.id, (db) => rows(db, 'select * from find_opportunities($1, $2, $3, $4, $5, $6, $7, false, false)', [m, p.category, p.demand, p.max, p.essential, p.form, p.price]));
  const out = (q ? list.filter((r) => String(r.inn).toLowerCase().includes(q)) : list).map((r) => ({
    molecule_id: r.molecule_id, inn: r.inn, category: r.category, registrants: r.registrants, registrations: r.registrations, on_national_list: r.on_national_list,
    on_who_eml: r.on_who_eml, demand: r.demand, fit_score: r.score, forms: r.forms, price_usd_per_unit: r.unit_usd, unit: r.unit, price_confidence: r.confidence, local_made: r.local_made }));
  return json({ market: m, count: out.length, molecules: out });
}
