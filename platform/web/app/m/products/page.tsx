import Link from 'next/link';
import Shell from '@/components/Shell';
import { Badges, Empty, Flash } from '@/components/ui';
import { addMfrProducts } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { registeredLine } from '@/lib/format';
import { MFR_PRODUCTS_SQL } from '@/lib/mfr';

export const metadata = { title: 'My products' };

export default async function MfrProducts({ searchParams }: { searchParams: Promise<{ added?: string; matched?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const products = await withUser(u.id, (db) => rows(db, `${MFR_PRODUCTS_SQL} where p.user_id = $1
      order by (p.molecule_id is null), (cm.on_national_list and cm.rankable) desc nulls last, g.score desc nulls last, p.name`, [u.id]));
  const unmatched = products.filter((p) => !p.molecule_id).length;
  return (
    <Shell user={u} title="My products" sub="Your catalogue, matched to the Tanzania market">
      <Flash sp={sp} />
      {sp.added && <div className="ok" role="status">Added {sp.added} products; {sp.matched} matched to a molecule on the market.
        {Number(sp.added) > Number(sp.matched) ? ' The rest we could not match by name; our team can match them for you.' : ''}</div>}
      <div className="split">
        <section className="card">
          <div className="card-h"><h2>{products.length} products</h2>{unmatched > 0 && <span className="note">{unmatched} not matched yet</span>}</div>
          {products.length === 0 ? <Empty>No products yet. Paste your list on the right.</Empty> : (
            <div>{products.map((p, i) => (
              <div key={p.id} className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '12px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                <div style={{ minWidth: 0, flex: '1 1 280px' }}>
                  <Link href={`/m/products/${p.id}`}><span className="nm">{p.inn ?? p.name}</span></Link>
                  <div className="sub2">{[p.inn ? p.name : null, p.molecule_id ? (p.registrants != null ? registeredLine(p.registrants, p.registrations) : 'Not on the Tanzania market') : 'Not matched to a molecule'].filter(Boolean).join(' · ')}</div>
                  {p.molecule_id && p.registrants != null && <div style={{ marginTop: 6 }}><Badges m={p} /></div>}
                </div>
                <Link className="btn btn-ghost btn-sm" href={`/m/products/${p.id}`}>Open</Link>
              </div>))}</div>)}
        </section>
        <section className="card stack">
          <h2>Add products</h2>
          <form action={addMfrProducts} className="stack">
            <label className="lbl" htmlFor="list">Paste your product list, one product per line</label>
            <textarea className="input" id="list" name="list" rows={10} required placeholder={'Amoxicillin 500mg capsules\nCeftriaxone 1g injection\nMetformin 500mg tablets'} />
            <button className="btn btn-blue" type="submit">Add and match</button>
          </form>
          <p className="note">Up to 500 lines at a time. Name, strength and form on each line work best. Our team matches anything we cannot.</p>
        </section>
      </div>
    </Shell>
  );
}
