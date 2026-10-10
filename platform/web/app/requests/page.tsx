import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { FREE, STAGES, fmtDate } from '@/lib/format';

export const metadata = { title: 'Requests' };

export default async function Requests() {
  const u = await requireUser();
  const d = await withUser(u.id, async (db) => ({
    reqs: await rows(db, `select r.id, r.stage, r.quantity, r.unit, r.created_at, r.updated_at, coalesce(m.inn, r.molecule_text) as molecule,
                          (select count(*)::int from quotes q where q.request_id = r.id) as quotes,
                          (select e.verdict from request_evaluations e where e.request_id = r.id) as verdict
                          from requests r left join molecules m on m.id = r.molecule_id where r.user_id = $1 order by r.updated_at desc`, [u.id]),
    orders: await rows(db, `select o.id, o.status, o.updated_at, coalesce(m.inn, r.molecule_text) as molecule, r.id as request_id
                            from orders o join requests r on r.id = o.request_id left join molecules m on m.id = r.molecule_id
                            where r.user_id = $1 order by o.updated_at desc`, [u.id]),
  }));
  const active = d.reqs.filter((r) => r.stage !== 'Closed').length;
  const full = u.plan !== 'paid' && active >= FREE.requests;
  return (
    <Shell user={u} title="Requests" sub="Sourcing requests you have sent"
      actions={full ? <span className="pill alert">{FREE.requests} of {FREE.requests} active</span> : <Link className="btn btn-blue btn-sm" href="/requests/new">Source a molecule</Link>}>
      {u.plan !== 'paid' && <p className="note">{active} of {FREE.requests} active (free plan). Closed requests do not count.</p>}
      <div className="board">
        {STAGES.map((s) => {
          const list = d.reqs.filter((r) => r.stage === s);
          return (
            <section key={s} className="col" aria-label={s}>
              <h3><span>{s}</span><span className="muted num">{list.length}</span></h3>
              {list.map((r) => (
                <Link key={r.id} href={`/requests/${r.id}`} className="rcard">
                  <span className="nm" style={{ fontSize: 14 }}>{r.molecule}</span>
                  <span className="sub2">{[[r.quantity, r.unit].filter(Boolean).join(' '), fmtDate(r.created_at)].filter(Boolean).join(' · ')}</span>
                  {r.verdict && s !== 'Quote ready' && <span className={`pill ${r.verdict === 'go' ? 'mint' : r.verdict === 'no' ? 'peach' : 'blue'}`} style={{ alignSelf: 'flex-start' }}>
                    Evaluated: {r.verdict === 'go' ? 'Go' : r.verdict === 'no' ? 'Skip' : 'Worth a look'}</span>}
                  {s === 'Quote ready' && <span className="pill solid" style={{ alignSelf: 'flex-start' }}>{r.quotes} quotes</span>}
                </Link>))}
            </section>);
        })}
      </div>
      <section className="card">
        <div className="card-h"><h2>Orders and shipments</h2></div>
        {d.orders.length === 0 ? <Empty>Accept a quote to open an order.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Order</th><th>Molecule</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{d.orders.map((o) => (
              <tr key={o.id}><td><Link href={`/requests/${o.request_id}`}>Order {o.id}</Link></td><td>{o.molecule}</td>
                <td><span className="pill blue">{o.status}</span></td><td>{fmtDate(o.updated_at)}</td></tr>))}
            </tbody></table></div>)}
      </section>
      <p className="note">Each card opens the request. Updates also arrive by email or WhatsApp, as set in Settings.</p>
    </Shell>
  );
}
