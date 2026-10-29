import { apiUser, json, marketOf } from '@/lib/api';
import { rows, withUser } from '@/lib/db';
export const dynamic = 'force-dynamic';
/** GET /api/v1/registrations?market=TZ&molecule=ID: every registered product of a molecule in a market. Holders are named on Complete Market Access. */
export async function GET(req: Request) {
  const a = await apiUser(req); if ('error' in a) return a.error;
  const m = marketOf(req, a.u); if (m instanceof Response) return m;
  const mol = Number(new URL(req.url).searchParams.get('molecule'));
  if (!mol) return json({ error: 'molecule is required (a molecule_id from /api/v1/molecules)' }, 400);
  const list = await withUser(a.u.id, (db) => rows(db, 'select * from molecule_registrations($1, $2)', [mol, m]));
  return json({ market: m, molecule_id: mol, count: list.length, registrations: list });
}
