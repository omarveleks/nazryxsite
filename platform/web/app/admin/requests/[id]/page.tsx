import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Empty, Flash, Stages } from '@/components/ui';
import { addOfferAndQuote, saveDossier, saveEvaluation, setOrderStatus, setStage } from '@/app/actions/admin';
import { postMessage } from '@/app/actions/app';
import { requireTeam } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { BE_STATUS, DOSSIER_ITEMS, DOSSIER_STATUS, GMP_BY, ORDER_STATUSES, SHIPMENT_DOCS, STAGES, beSuggestion, fmtDate } from '@/lib/format';

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
      docs: await rows(db, 'select d.doc, d.ready from shipment_documents d join orders o on o.id = d.order_id where o.request_id = $1', [id]),
      dossier: await one(db, 'select * from request_dossier where request_id = $1', [id]),
      items: await rows(db, 'select item, status, note from dossier_items where request_id = $1', [id]),
      forms: r.molecule_id ? (await one(db, "select forms from country_molecules where molecule_id = $1 and country = 'TZ'", [r.molecule_id]))?.forms : null,
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
            <div className="card-h"><h2>Assessment</h2>{d.evaluation && <span className="note">Saved {fmtDate(d.evaluation.evaluated_at)}</span>}</div>
            {d.facts && <p className="note">Registered by {d.facts.registrants} companies, {d.facts.registrations} products
              {d.facts.on_national_list ? ` · official TMDA list, level ${d.facts.facility_level || 'not stated'}` : ' · not on the official TMDA list'}
              {d.facts.on_who_eml ? ' · WHO essential list' : ''}{d.facts.channel_flag === 'programme' ? ' · programme channel' : ''}
              {d.facts.supply ? ' · we hold confirmed supply' : ''}</p>}
            <form action={saveEvaluation} className="form-grid">
              <input type="hidden" name="request_id" value={id} />
              <div className="field full"><label htmlFor="verdict">Verdict</label>
                <select className="input" id="verdict" name="verdict" defaultValue={d.evaluation?.verdict ?? ''} required>
                  <option value="" disabled>Pick one</option><option value="go">Go</option><option value="maybe">Worth a look</option><option value="no">Skip</option></select></div>
              <div className="field full"><label htmlFor="summary">Why (two or three lines, shown to the customer)</label>
                <textarea className="input" id="summary" name="summary" defaultValue={d.evaluation?.summary ?? ''} required /></div>
              <div className="field full"><label htmlFor="regulatory_check">2. Regulatory check: who holds a registration, status, restrictions</label>
                <textarea className="input" id="regulatory_check" name="regulatory_check" defaultValue={d.evaluation?.regulatory_check ?? ''} /></div>
              <div className="field full"><label htmlFor="route">3. Regulatory analysis: route, requirements, timeline</label>
                <textarea className="input" id="route" name="route" defaultValue={d.evaluation?.route ?? ''} placeholder="e.g. Full dossier (CTD), about 12 months" /></div>
              <div className="field full"><label htmlFor="supply">4. Supply and lead time</label>
                <input className="input" id="supply" name="supply" defaultValue={d.evaluation?.supply ?? ''} placeholder="e.g. Two GMP suppliers, 6-8 weeks" /></div>
              <div className="field full"><label htmlFor="price_range">4. Indicative price</label>
                <input className="input" id="price_range" name="price_range" defaultValue={d.evaluation?.price_range ?? ''} placeholder="e.g. USD 0.80-1.10 per pack" /></div>
              <button className="btn btn-blue btn-sm full" type="submit">{d.evaluation ? 'Update assessment' : 'Send assessment to the customer'}</button>
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
                <input className="input full" name="payment_terms" placeholder="Payment terms, e.g. 30% deposit, 70% before shipment" aria-label="Payment terms" />
                <input className="input" name="shelf_life_pct" placeholder="Min. shelf life on arrival, %" aria-label="Minimum shelf life on arrival in percent" inputMode="numeric" />
                <select className="input" name="gmp_by" aria-label="GMP certified by" defaultValue=""><option value="">GMP certified by: not set</option>
                  {GMP_BY.map((g) => <option key={g}>{g}</option>)}</select>
                <select className="input" name="supplier_type" aria-label="Supplier type" defaultValue=""><option value="">Manufacturer or trader: not set</option>
                  <option value="manufacturer">Manufacturer</option><option value="trader">Trader</option></select>
                <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="exclusive" /> Exclusive for this customer</label>
                <button className="btn btn-blue btn-sm full" type="submit">Add offer and anonymous quote</button>
                <p className="note full">The customer sees the label (Supplier A, B ...), MOQ, lead time, certs, payment terms, shelf life, GMP certifier,
                  manufacturer or trader, exclusivity and the target note. Name, contact and price unlock when they accept.</p>
              </form>)}
          </section>
          <section className="card stack">
            <h2>Dossier readiness</h2>
            <form action={saveDossier} className="stack" style={{ gap: 10 }}>
              <input type="hidden" name="request_id" value={id} />
              <div className="row">
                <select className="input" name="be_status" aria-label="Bioequivalence" defaultValue={d.dossier?.be_status ?? beSuggestion(d.forms) ?? ''} style={{ flex: '0 1 300px' }}>
                  <option value="">Bioequivalence: not decided</option>
                  {Object.entries(BE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input className="input" name="be_note" defaultValue={d.dossier?.be_note ?? ''} placeholder="BE note (shown to the customer)" aria-label="BE note" style={{ flex: '1 1 200px' }} />
              </div>
              {!d.dossier && beSuggestion(d.forms) && <p className="note">Suggested from the registered forms ({d.forms}). Confirm or change it.</p>}
              {DOSSIER_ITEMS.map(([k, label]) => {
                const it = d.items.find((x) => x.item === k);
                return (
                  <div key={k} className="row">
                    <span style={{ flex: '1 1 240px' }} className="small">{label}</span>
                    <select className="input" name={`item_${k}`} defaultValue={it?.status ?? ''} aria-label={label} style={{ flex: '0 1 150px' }}>
                      <option value="">Not checked</option>
                      {Object.entries(DOSSIER_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</select>
                    <input className="input" name={`note_${k}`} defaultValue={it?.note ?? ''} placeholder="Note" aria-label={`Note: ${label}`} style={{ flex: '1 1 160px' }} />
                  </div>);
              })}
              <button className="btn btn-blue btn-sm" type="submit">Save dossier readiness</button>
            </form>
          </section>
          {d.order && (
            <section className="card stack">
              <h2>Shipment #{d.order.id}</h2>
              <form action={setOrderStatus} className="stack" style={{ gap: 10 }}><input type="hidden" name="request_id" value={id} /><input type="hidden" name="order_id" value={d.order.id} />
                <div className="row">
                  <select className="input" name="status" defaultValue={d.order.status} aria-label="Shipment status" style={{ flex: '0 1 220px' }}>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                  <label className="row small" style={{ gap: 6 }}>ETA <input className="input" type="date" name="eta" defaultValue={d.order.eta ? String(d.order.eta).slice(0, 10) : ''} /></label>
                </div>
                <div className="stack" style={{ gap: 6 }}>{SHIPMENT_DOCS.map(([k, l]) => (
                  <label key={k} className="row small" style={{ gap: 6 }}>
                    <input type="checkbox" name={`doc_${k}`} defaultChecked={d.docs.some((x) => x.doc === k && x.ready)} /> {l}</label>))}</div>
                <button className="btn btn-blue btn-sm" type="submit">Update shipment</button></form>
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
