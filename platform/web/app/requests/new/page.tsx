import Link from 'next/link';
import Shell from '@/components/Shell';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { FREE } from '@/lib/format';
import { activeRequestCount } from '@/lib/queries';
import { createRequest } from '@/app/actions/app';

export const metadata = { title: 'New request' };

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ molecule?: string; missing?: string; sent?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const d = await withUser(u.id, async (db) => {
    const mol = sp.molecule ? await one(db, 'select id, inn from molecules where id = $1', [Number(sp.molecule) || 0]) : null;
    const names = await rows(db, `select m.inn from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = 'TZ'
                                  order by cm.on_national_list desc, m.inn limit 2000`);
    let notes = '';
    if (sp.missing) {
      const cats = sp.missing.split('|').slice(0, 3);
      const miss = await rows(db, `select m.category, string_agg(m.inn, ', ' order by g.score desc nulls last) as list
          from country_molecules cm join molecules m on m.id = cm.molecule_id left join visible_gap_scores g on g.molecule_id = m.id and g.country = cm.country
          where cm.country = 'TZ' and cm.on_national_list and cm.rankable and m.category = any($1)
            and m.id not in (select molecule_id from portfolio_items where user_id = $2) group by m.category`, [cats, u.id]);
      notes = miss.map((r) => `Missing in ${r.category}: ${r.list}`).join('\n');
    }
    return { mol, names, notes, active: await activeRequestCount(db, u.id) };
  });
  if (sp.sent) {
    return (
      <Shell user={u} title="Request sent" crumb={<><Link href="/requests">Requests</Link> / New request</>}>
        <section className="card stack" style={{ alignItems: 'flex-start' }}>
          <div className="ok" role="status">Request sent. Our team will reach out to you for more info. It is now in your requests with its stage shown.</div>
          <div className="row"><Link className="btn btn-blue" href={`/requests/${Number(sp.sent)}`}>Open the request</Link>
            <Link className="btn btn-ghost" href="/requests">View my requests</Link></div>
        </section>
      </Shell>
    );
  }
  const full = u.plan !== 'paid' && d.active >= FREE.requests;
  return (
    <Shell user={u} title="Source a molecule" sub="We evaluate it for you first, then find suppliers" crumb={<><Link href="/requests">Requests</Link> / New request</>}>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      <div className="split">
        <section className="card">
          {full ? (
            <div className="locked"><b>You have {FREE.requests} active requests, the free-plan limit.</b>
              <span className="note">Close one, or upgrade for more.</span><Link className="btn btn-ghost btn-sm" href="/settings#plan">Upgrade</Link></div>
          ) : (
            <form action={createRequest} className="form-grid">
              <div className="field full"><label htmlFor="molecule">Molecule</label>
                {d.mol ? (<><input type="hidden" name="molecule_id" value={d.mol.id} /><input className="input" id="molecule" value={d.mol.inn} readOnly /></>) : (<>
                  <input className="input" id="molecule" name="molecule" list="mols" required placeholder="Start typing a molecule" autoComplete="off" />
                  <datalist id="mols">{d.names.map((n) => <option key={n.inn} value={n.inn} />)}</datalist></>)}
              </div>
              <div className="field"><label htmlFor="quantity">Quantity, if you know it</label><input className="input" id="quantity" name="quantity" placeholder="e.g. 50,000" /></div>
              <div className="field"><label htmlFor="unit">Unit</label>
                <select className="input" id="unit" name="unit"><option>packs</option><option>tablets</option><option>vials</option><option>bottles</option><option>kg</option></select></div>
              <div className="field"><label htmlFor="target_price">Target price</label><input className="input" id="target_price" name="target_price" placeholder="e.g. USD 1.20 per pack" /></div>
              <div className="field"><label htmlFor="deliver_by">Delivery by</label><input className="input" id="deliver_by" name="deliver_by" type="date" /></div>
              <div className="field full"><label htmlFor="notes">Notes</label><textarea className="input" id="notes" name="notes" defaultValue={d.notes} placeholder="Strength, form, pack size, certificates you need" /></div>
              <div className="field drop"><label htmlFor="attachments">Attach documents</label><input id="attachments" name="attachments" type="file" multiple /></div>
              <div className="field drop"><label htmlFor="requirement_list">Upload requirement list (bulk)</label><input id="requirement_list" name="requirement_list" type="file" accept=".xls,.xlsx,.csv,.pdf" /></div>
              <div className="full"><button className="btn btn-blue" type="submit">Send request</button></div>
            </form>
          )}
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>What happens next</h2>
          <ol className="steps">
            <li><em>01</em><span>We evaluate it for you: competitors, supply, price range and registration route. You get a clear go or skip.</span></li>
            <li><em>02</em><span>If it is worth it, we find suppliers.</span></li>
            <li><em>03</em><span>You compare anonymous quotes.</span></li>
            <li><em>04</em><span>You accept one and the supplier is revealed.</span></li>
          </ol>
          {u.plan !== 'paid' && <p className="note" style={{ marginTop: 10 }}>{d.active} of {FREE.requests} active requests on the free plan.</p>}
        </section>
      </div>
    </Shell>
  );
}
