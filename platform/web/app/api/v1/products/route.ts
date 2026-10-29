import { apiUser, json } from '@/lib/api';
import { rows, withUser } from '@/lib/db';
export const dynamic = 'force-dynamic';
/** GET /api/v1/products: your catalogue as the portal holds it, with the molecule each product matched to and, per market in the plan, competition and demand. */
export async function GET(req: Request) {
  const a = await apiUser(req); if ('error' in a) return a.error;
  const out = await withUser(a.u.id, async (db) => {
    const products = await rows(db, `select p.id, p.name, p.strength, p.dosage_form, p.molecule_id, m.inn, m.category, p.who_pq, p.sra_approved, p.created_at
        from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by p.name`, [a.u.id]);
    const facts = await rows(db, `select cm.molecule_id, cm.country, cm.registrants, cm.registrations, cm.on_national_list, g.demand, g.score from country_molecules cm
        left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country
        where cm.country = any($1) and cm.molecule_id in (select molecule_id from mfr_products where user_id = $2 and molecule_id is not null)`, [a.u.markets, a.u.id]);
    return products.map((p) => ({ ...p, markets: facts.filter((f) => f.molecule_id === p.molecule_id).map(({ molecule_id: _m, ...f }) => f) }));
  });
  return json({ count: out.length, products: out });
}
