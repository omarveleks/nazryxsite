import { getUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';

// Type-ahead for adding products: molecules we track (registered or on an essential list) first, then the worldwide
// medicine list. Signed-in users only.
export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return Response.json([], { status: 401 });
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return Response.json([]);
  const list = await withUser(u.id, (db) => rows(db, `
    select distinct on (lower(name)) name, atc, molecule_id, tracked from (
      select m.inn as name, null::text as atc, m.id as molecule_id, true as tracked from molecules m
        where m.inn ilike '%' || $1 || '%' and exists (select 1 from country_molecules cm where cm.molecule_id = m.id)
      union all
      select c.name, c.atc, null, false from medicine_catalog c where c.name ilike '%' || $1 || '%'
    ) x order by lower(name), tracked desc`, [q]));
  const ql = q.toLowerCase();
  const rank = (n: string) => (n.toLowerCase() === ql ? 0 : n.toLowerCase().startsWith(ql) ? 1 : 2);
  list.sort((a, b) => rank(a.name) - rank(b.name) || Number(b.tracked) - Number(a.tracked) || a.name.length - b.name.length);
  return Response.json(list.slice(0, 12).map((x) => ({ name: x.name, atc: x.atc, tracked: x.tracked })),
    { headers: { 'Cache-Control': 'private, max-age=300' } });
}
