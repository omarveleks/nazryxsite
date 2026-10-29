import { apiUser, json, marketOf } from '@/lib/api';
import { rows, withUser } from '@/lib/db';
export const dynamic = 'force-dynamic';
/** GET /api/v1/tenders?market=TZ[&stage=open|awarded|closed&since=YYYY-MM-DD&molecule=ID]: public medicine tenders with buyer, dates, quantity, prices and result. */
export async function GET(req: Request) {
  const a = await apiUser(req); if ('error' in a) return a.error;
  const m = marketOf(req, a.u); if (m instanceof Response) return m;
  const sp = new URL(req.url).searchParams;
  const stage = ['open', 'awarded', 'closed'].includes(sp.get('stage') ?? '') ? sp.get('stage') : null;
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('since') ?? '') ? sp.get('since') : null;
  const mol = Number(sp.get('molecule')) || null;
  const list = await withUser(a.u.id, (db) => rows(db, `select t.id, t.ref, coalesce(t.title_en, t.title) as title, t.title as title_original, coalesce(t.buyer_en, t.buyer) as buyer, t.stage, t.published, t.closing, t.awarded,
      t.quantity, t.unit_price, t.value, t.currency, t.bidders, t.url, t.molecule_ids, t.updated_at from tenders t
      where t.country = $1 and ($2::text is null or t.stage = $2) and ($3::date is null or t.updated_at >= $3) and ($4::int is null or $4 = any(t.molecule_ids))
      order by coalesce(t.awarded, t.closing, t.published) desc nulls last limit 2000`, [m, stage, since, mol]));
  return json({ market: m, count: list.length, tenders: list });
}
