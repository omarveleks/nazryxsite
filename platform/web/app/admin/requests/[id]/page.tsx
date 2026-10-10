import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Empty, Flash, Stages } from '@/components/ui';
import { addOfferAndQuote, saveEvaluation, setOrderStatus, setStage } from '@/app/actions/admin';
import { postMessage } from '@/app/actions/app';
import { requireTeam } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { ORDER_STATUSES, STAGES, fmtDate } from '@/lib/format';

export default async function AdminRequest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireTeam();
  const d = await withUser(u.id, async (db) => {
    const r = await one(db, `select r.*, coalesce(m.inn, r.molecule_text) as molecule, us.email, us.name, us.whatsapp, us.plan
                             from requests r join users us on us.id = r.user_id left join molecules m on m.id = r.molecule_id where r.id = $1`, [id]);
    if (!r) return null;
    return {
      r,
      quotes: await rows(db, `select q.*, s.name as supplier, o.price, o.currency, o.unit from quotes q join supplier_offers o on o.id = q.supplier_offer_id
                              join suppliers s on s.id = o.supplier_id where q.request_id = $1 order by q.label`, [id]),
      suppliers: await rows(db, 'select id, name, country from suppliers order by name'),
      files: await rows(db, 'select id, file_name, kind from request_files where request_id = $1', [id]),
      messages: await rows(db, 'select from_team, body, created_at from request_messages where request_id = $1 order by created_at', [id]),
      order: await one(db, 'select * from orders where request_id = $1', [id]),
      evaluation: await one(db, 'select * from request_evaluations where request_id = $1', [id]),
      facts: r.molecule_id ? await one(db, `select cm.registrants, cm.registrations, cm.on_national_list, cm.on_who_eml, cm.facility_level,
                                             cm.channel_flag, molecule_supply_confirmed($1) as supply
                                             from country_molecules cm where cm.molecule_id = $1 and cm.country = 'TZ'`, [r.molecule_id]) : null,
      history: await rows(db, 'select stage, created_at from request_stage_history where request_id = $1 order by created_at', [id]),
    };
  });
  if (!d) notFound();
  const { r } = d;
  return (
    <Shell user={u} title={`Request #${id}: ${r.molecule}`} crumb={<><Link href="/admin?tab=requests">Admin / Requests</Link> / #{id}</>}
      sub={`${r.name || r.email} (${r.email}${r.whatsapp ? `, WhatsApp ${r.whatsapp}` : ''}) · ${r.plan} plan`}>
      <Flash sp={sp} />
      <Stages current={r.stage} />
      <div className="split">
        <div className="stack">
          <section className="card stack">
            <h2>Request</h2>
            <table className="tbl"><tbody>
              <tr><td>Quantity</td><td>{r.quantity} {r.unit}</td></tr><tr><td>Target price</td><td>{r.target_price || '—'}</td></tr>
              <tr><td>Deliver by</td><td>{r.deliver_by ? fmtDate(r.deliver_by) : '—'}</td></tr><tr><td>Notes</td><td style={{ whiteSpace: 'pre-wrap' }}>{r.notes || '—'}</td></tr>
            </tbody></table>
            <form action={setStage} className="row"><input type="hidden" name="request_id" value={id} />
              <select className="input" name="stage" defaultValue={r.stage} aria-label="Stage" style={{ flex: '0 1 220px' }}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
              <input className="input" name="closed_reason" placeholder="Reason if closing" aria-label="Reason if closing" style={{ flex: '1 1 160px' }} />
              <button className="btn btn-blue btn-sm" type="submit">Update stage</button></form>
            <p className="note">History: {d.history.map((h) => `${h.stage} (${fmtDate(h.created_at)})`).join(' → ')}</p>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>Evaluation</h2>{d.evaluation && <span className="note">Saved {fmtDate(d.evaluation.evaluated_at)}</span>}</div>
            {d.facts && <p className="note">Registered by {d.facts.registrants} companies, {d.facts.registrations} products
              {d.facts.on_national_list ? ` · official list, level ${d.facts.facility_level || 'not stated'}` : ' · not on the official list'}
              {d.facts.on_who_eml ? ' · global essential list' : ''}{d.facts.channel_flag === 'programme' ? ' · programme channel' : ''}
              {d.facts.supply ? ' · we hold confirmed supply' : ''}</p>}
            <form action={saveEvaluation} className="form-grid">
              <input type="hidden" name="request_id" value={id} />
              <div className="field full"><label htmlFor="verdict">Verdict</label>
                <select className="input" id="verdict" name="verdict" defaultValue={d.evaluation?.verdict ?? ''} required>
                  <option value="" disabled>Pick one</option><option value="go">Go</option><option value="maybe">Worth a look</option><option value="no">Skip</option></select></div>
              <div className="field full"><label htmlFor="summary">Why (two or three lines, shown to the customer)</label>
                <textarea className="input" id="summary" name="summary" defaultValue={d.evaluation?.summary ?? ''} required /></div>
              <div className="field full"><label htmlFor="supply">Supply</label>
                <input className="input" id="supply" name="supply" defaultValue={d.evaluation?.supply ?? ''} placeholder="e.g. Two GMP suppliers, 6-8 weeks" /></div>
              <div className="field"><label htmlFor="price_range">Indicative price</label>
                <input className="input" id="price_range" name="price_range" defaultValue={d.evaluation?.price_range ?? ''} placeholder="e.g. USD 0.80-1.10 per pack" /></div>
              <div className="field"><label htmlFor="route">Registration route</label>
                <input className="input" id="route" name="route" defaultValue={d.evaluation?.route ?? ''} placeholder="e.g. Full dossier, about 12 months" /></div>
              <button className="btn btn-blue btn-sm full" type="submit">{d.evaluation ? 'Update evaluation' : 'Send evaluation to the customer'}</button>
              <p className="note full">Never name suppliers here. The customer sees this on their request page and gets an email and WhatsApp.</p>
            </form>
          </section>
          <section className="card stack">
            <h2>Quotes</h2>
            {d.quotes.length === 0 && <Empty>No quotes yet.</Empty>}
            {d.quotes.map((q) => (
              <div key={q.id} className="between"><span><b>{q.label}</b> = {q.supplier} · {q.currency} {q.price ?? '—'}{q.unit ? `/${q.unit}` : ''} · MOQ {q.moq || '—'} · {q.lead_time_weeks ?? '—'} wks</span>
                {q.accepted ? <span className="pill solid">Accepted</span> : <span className="pill">{q.price_vs_target ?? 'no target note'}</span>}</div>))}
            {r.stage !== 'Closed' && (
              <form action={addOfferAndQuote} className="form-grid">
                <input type="hidden" name="request_id" value={id} />
                <div className="field full"><label htmlFor="supplier_id">Supplier</label>
                  <select className="input" id="supplier_id" name="supplier_id" defaultValue=""><option value="">New supplier (fill below)</option>
                    {d.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.country ? ` (${s.country})` : ''}</option>)}</select></div>
                <input className="input" name="supplier_name" placeholder="New supplier name" aria-label="New supplier name" />
                <input className="input" name="supplier_country" placeholder="Country" aria-label="Supplier country" />
                <input className="input full" name="supplier_contact" placeholder="Contact (revealed to the customer after acceptance)" aria-label="Supplier contact" />
                <textarea className="input full" name="supplier_notes" placeholder="Internal notes (never shown to customers)" aria-label="Internal notes" />
                <input className="input" name="price" placeholder="Unit price" aria-label="Unit price" inputMode="decimal" />
                <div className="row"><input className="input" name="currency" defaultValue="USD" aria-label="Currency" style={{ flex: 1 }} />
                  <input className="input" name="unit" placeholder="per pack" aria-label="Unit" style={{ flex: 1 }} /></div>
                <input className="input" name="moq" placeholder="MOQ" aria-label="MOQ" />
                <input className="input" name="lead_time_weeks" placeholder="Lead time (weeks)" aria-label="Lead time in weeks" inputMode="numeric" />
                <input className="input" name="certs" placeholder="Certs, e.g. GMP" aria-label="Certificates" />
                <select className="input" name="price_vs_target" aria-label="Price vs customer target" defaultValue=""><option value="">Price vs target: not set</option>
                  <option value="below">Below target</option><option value="at">At target</option><option value="above">Above target</option></select>
                <button className="btn btn-blue btn-sm full" type="submit">Add offer and anonymous quote</button>
                <p className="note full">The customer sees only the label (Supplier A, B ...), MOQ, lead time, certs and the target note. Name, contact and price unlock when they accept. Set the stage to &quot;Quote ready&quot; when done.</p>
              </form>)}
          </section>
          {d.order && (
            <section className="card stack">
              <h2>Order {d.order.id}</h2>
              <form action={setOrderStatus} className="row"><input type="hidden" name="request_id" value={id} /><input type="hidden" name="order_id" value={d.order.id} />
                <select className="input" name="status" defaultValue={d.order.status} aria-label="Order status" style={{ flex: '0 1 220px' }}>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                <button className="btn btn-blue btn-sm" type="submit">Update order</button></form>
            </section>)}
        </div>
        <div className="stack">
          <section className="card stack">
            <h2>Messages</h2>
            {d.messages.map((m, i) => <div key={i} className={`msg ${m.from_team ? 'me' : 'team'}`}><b>{m.from_team ? 'Nazryx' : 'Customer'}:</b> {m.body}</div>)}
            <form action={postMessage} className="stack"><input type="hidden" name="request_id" value={id} /><input type="hidden" name="return" value={`/admin/requests/${id}`} />
              <textarea className="input" name="body" placeholder="Message to the customer (also sent by email/WhatsApp)" aria-label="Message" required />
              <button className="btn btn-blue btn-sm" type="submit">Send</button></form>
          </section>
          <section className="card stack">
            <h2>Attachments</h2>
            {d.files.length === 0 && <Empty>None.</Empty>}
            {d.files.map((f) => <a key={f.id} href={`/files/request/${f.id}`}>{f.file_name}{f.kind === 'requirement_list' ? ' (requirement list)' : ''}</a>)}
          </section>
        </div>
      </div>
    </Shell>
  );
}
