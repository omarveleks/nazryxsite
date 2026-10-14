import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { FREE, PIPELINE, STAGE_INFO, fmtDate } from '@/lib/format';

export const metadata = { title: 'Requests' };

const VERDICT: Record<string, [string, string]> = { go: ['Go', 'mint'], maybe: ['Worth a look', 'blue'], no: ['Skip', 'peach'] };

// Every request follows the pharmaceutical route, from the product request to registration and shipment.
export default async function Requests({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const d = await withUser(u.id, async (db) => ({
    reqs: await rows(db, `select r.id, r.stage, r.quantity, r.unit, r.created_at, r.updated_at, r.closed_reason, coalesce(m.inn, r.molecule_text) as molecule,
                          (select count(*)::int from quotes q where q.request_id = r.id) as quotes,
                          exists (select 1 from quotes q where q.request_id = r.id and q.accepted) as accepted,
                          (select e.verdict from request_evaluations e where e.request_id = r.id) as verdict
                          from requests r left join molecules m on m.id = r.molecule_id where r.user_id = $1 order by r.updated_at desc`, [u.id]),
    orders: await rows(db, `select o.id, o.status, o.updated_at, coalesce(m.inn, r.molecule_text) as molecule, r.id as request_id
                            from orders o join requests r on r.id = o.request_id left join molecules m on m.id = r.molecule_id
                            where r.user_id = $1 and r.stage in ('Shipment', 'Closed') order by o.updated_at desc`, [u.id]),
  }));
  const early = d.reqs.filter((r) => ['Product request', 'Regulatory check', 'Regulatory analysis', 'Pricing and logistics'].includes(r.stage)).length;
  const closed = d.reqs.filter((r) => r.stage === 'Closed');
  const full = u.plan !== 'paid' && early >= FREE.requests;
  return (
    <Shell user={u} title="Requests" sub="From product request to registration and shipment"
      actions={full ? <span className="pill alert">{FREE.requests} of {FREE.requests} active</span> : <Link className="btn btn-blue btn-sm" href="/requests/new">New request</Link>}>
      {sp.sent && <div className="ok" role="status">{sp.sent} {sp.sent === '1' ? 'request' : 'requests'} sent. We start with the regulatory check.</div>}
      {u.plan !== 'paid' && <p className="note">{early} of {FREE.requests} requests in progress on the free plan. Products in registration or shipment do not count.</p>}
      <div className="board">
        {PIPELINE.map((s, i) => {
          const list = d.reqs.filter((r) => r.stage === s);
          return (
            <section key={s} className="col" aria-label={s}>
              <h3><span>{i + 1}. {s}</span><span className="muted num">{list.length}</span></h3>
              <span className="tiny muted" style={{ padding: '0 4px' }}>{STAGE_INFO[s]}</span>
              {list.map((r) => (
                <Link key={r.id} href={`/requests/${r.id}`} className="rcard">
                  <span className="nm" style={{ fontSize: 14 }}>{r.molecule}</span>
                  <span className="sub2">{[[r.quantity, r.unit].filter(Boolean).join(' '), fmtDate(r.created_at)].filter(Boolean).join(' · ')}</span>
                  {r.verdict && <span className={`pill ${VERDICT[r.verdict][1]}`} style={{ alignSelf: 'flex-start' }} title="Our assessment">{VERDICT[r.verdict][0]}</span>}
                  {s === 'Pricing and logistics' && r.quotes > 0 && !r.accepted && <span className="pill solid" style={{ alignSelf: 'flex-start' }}>{r.quotes} quotes</span>}
                </Link>))}
            </section>);
        })}
      </div>
      <div className="grid g2">
        <section className="card">
          <div className="card-h"><h2>Shipments</h2></div>
          {d.orders.length === 0 ? <Empty>Shipments appear here once a product is registered and ordered.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Shipment</th><th>Molecule</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>{d.orders.map((o) => (
                <tr key={o.id}><td><Link href={`/requests/${o.request_id}`}>#{o.id}</Link></td><td>{o.molecule}</td>
                  <td><span className="pill blue">{o.status}</span></td><td>{fmtDate(o.updated_at)}</td></tr>))}
              </tbody></table></div>)}
        </section>
        <section className="card">
          <div className="card-h"><h2>Closed</h2><span className="note num">{closed.length}</span></div>
          {closed.length === 0 ? <Empty>Requests we stop, or you no longer need, end here.</Empty> : (
            <div className="stack" style={{ gap: 8 }}>{closed.slice(0, 8).map((r) => (
              <Link key={r.id} href={`/requests/${r.id}`} className="between"><span>{r.molecule}</span><span className="sub2">{r.closed_reason || 'Closed'}</span></Link>))}</div>)}
        </section>
      </div>
      <p className="note">Each card opens the request. Updates also arrive by email or WhatsApp, as set in Settings.</p>
    </Shell>
  );
}
