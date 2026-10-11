import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash } from '@/components/ui';
import { requestIntro } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { categories } from '@/lib/queries';

export const metadata = { title: 'Partners' };

// Distributors in Tanzania, without names. Each profile has a code; the team turns it into an introduction.
export default async function Partners({ searchParams }: { searchParams: Promise<{ class?: string; molecule?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const paid = u.plan === 'paid' || u.role === 'team';
  const d = await withUser(u.id, async (db) => {
    const cats = await categories(db);
    const mine = await rows(db, `select distinct m.category from mfr_products p join molecules m on m.id = p.molecule_id
                                 where p.user_id = $1 and m.category is not null order by 1`, [u.id]);
    const cls = sp.class && cats.includes(sp.class) ? sp.class : mine[0]?.category ?? cats[0];
    const molecule = Number(sp.molecule) || null;
    const mol = molecule ? await one(db, 'select inn from molecules where id = $1', [molecule]) : null;
    const list = cls ? await rows(db, 'select * from partner_profiles($1, $2)', [cls, molecule]) : [];
    const status = (await one(db, 'select status from manufacturer_profiles where user_id = $1', [u.id]))?.status;
    const products = await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                                     where p.user_id = $1 order by 2 limit 300`, [u.id]);
    return { cats, cls, mol, molecule, list, status, products };
  });
  const shown = paid ? d.list : d.list.slice(0, 3);
  return (
    <Shell user={u} title="Partners" sub="Distributors in Tanzania who could carry your products">
      <Flash sp={sp} />
      <form method="get" className="card tight row">
        <select className="input" name="class" defaultValue={d.cls} aria-label="Therapeutic class" style={{ flex: '1 1 260px' }}>
          {d.cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        {d.molecule && <input type="hidden" name="molecule" value={d.molecule} />}
        <button className="btn btn-blue" type="submit">Show distributors</button>
      </form>
      <section className="card">
        <div className="card-h"><div><h2>Strongest in {d.cls}</h2>
          <p className="note">Profiles from public registration data. Names stay with us: we make the introduction{d.mol ? `, and show who already carries ${d.mol.inn}` : ''}.</p></div></div>
        {shown.length === 0 ? <Empty>No distributor with products in this class yet.</Empty> : (
          <div>{shown.map((p, i) => (
            <div key={p.code} className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '14px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
              <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                <span className="nm">Distributor {p.code}</span>
                <div className="sub2">{p.in_class} molecules in this class · {p.products} registered products · {p.classes} classes</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {p.levels && <span className="pill blue">Reaches EML levels {p.levels.split('').join(', ')}</span>}
                  {d.molecule && <span className={`pill ${p.carries ? '' : 'mint'}`}>{p.carries ? `Already carries ${d.mol?.inn}` : `Does not carry ${d.mol?.inn}`}</span>}
                  {p.local_maker && <span className="pill">Also manufactures</span>}
                </div>
              </div>
              {d.status === 'approved' ? (
                <form action={requestIntro} className="row" style={{ gap: 6 }}>
                  <input type="hidden" name="code" value={p.code} /><input type="hidden" name="class" value={d.cls} />
                  <select className="input" name="product_id" aria-label="For which product" defaultValue="" style={{ maxWidth: 200 }}>
                    <option value="">Any product</option>{d.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  <button className="btn btn-blue btn-sm" type="submit">Request introduction</button>
                </form>
              ) : <span className="note">Introductions open once our team approves your company.</span>}
            </div>))}</div>)}
        {!paid && d.list.length > shown.length && (
          <div className="locked" style={{ marginTop: 12 }}><span className="pill lav">Paid</span>
            <b>{d.list.length - shown.length} more distributors in this class</b>
            <Link className="btn btn-ghost btn-sm" href="/settings#plan">Upgrade</Link></div>)}
      </section>
      <p className="note">Introductions are part of our agency service: we contact the distributor, present your product and help agree terms.</p>
    </Shell>
  );
}
