import type React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Empty, Stages } from '@/components/ui';
import { DossierReadiness, QuoteTerms, ShipmentTrack } from '@/components/Pharma';
import { acceptQuote, addRequestFile, postMessage } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { PIPELINE, STAGE_INFO, fmtDate } from '@/lib/format';

const VERDICT: Record<string, { label: string; cls: string }> = {
  go: { label: 'Go', cls: 'mint' }, maybe: { label: 'Worth a look', cls: 'blue' }, no: { label: 'Skip', cls: 'peach' },
};
const PVT: Record<string, string> = { below: 'Below your target price', at: 'At your target price', above: 'Above your target price' };

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; accepted?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser();
  const d = await withUser(u.id, async (db) => {
    // RLS: a customer only ever gets their own request back
    const r = await one(db, `select r.*, coalesce(m.inn, r.molecule_text) as molecule from requests r left join molecules m on m.id = r.molecule_id
                             where r.id = $1 and r.user_id = $2`, [id, u.id]);
    if (!r) return null;
    return {
      r,
      quotes: await rows(db, `select id, label, moq, lead_time_weeks, certs, price_vs_target, accepted, payment_terms, shelf_life_pct, gmp_by,
                              supplier_type, exclusive from quotes where request_id = $1 order by label`, [id]),
      dossier: await one(db, 'select be_status, be_note from request_dossier where request_id = $1', [id]),
      items: await rows(db, 'select item, status, note from dossier_items where request_id = $1', [id]),
      docs: await rows(db, 'select d.doc, d.ready from shipment_documents d join orders o on o.id = d.order_id where o.request_id = $1', [id]),
      revealed: await one(db, 'select * from accepted_supplier where request_id = $1', [id]),
      files: await rows(db, 'select id, file_name, kind, created_at from request_files where request_id = $1 order by created_at', [id]),
      messages: await rows(db, 'select from_team, body, created_at from request_messages where request_id = $1 order by created_at', [id]),
      order: await one(db, 'select id, status, eta, updated_at from orders where request_id = $1', [id]),
      evaluation: await one(db, `select verdict, summary, regulatory_check, supply, price_range, route, evaluated_at
                                  from request_evaluations where request_id = $1`, [id]),
    };
  });
  if (!d) notFound();
  const { r } = d;
  const canAccept = r.stage !== 'Closed' && !d.quotes.some((q) => q.accepted);
  const at = PIPELINE.indexOf(r.stage);
  const state = (s: string) => r.stage === 'Closed' ? '' : PIPELINE.indexOf(s as any) < at ? 'Done' : s === r.stage ? 'Now' : 'Next';
  const Step = ({ n, s, children }: { n: number; s: string; children: React.ReactNode }) => (
    <section className="card">
      <div className="card-h"><h2>{n}. {s}</h2>{state(s) && <span className={`pill ${state(s) === 'Now' ? 'solid' : state(s) === 'Done' ? 'mint' : ''}`}>{state(s)}</span>}</div>
      <p className="note" style={{ marginBottom: 10 }}>{STAGE_INFO[s]}</p>
      {children}
    </section>);
  const ev = d.evaluation;
  return (
    <Shell user={u} title={`Request: ${r.molecule}`} crumb={<><Link href="/requests">Requests</Link> / {r.molecule}</>}
      sub={[r.quantity && `Quantity ${r.quantity}${r.unit ? ' ' + r.unit : ''}`, r.target_price && `target price ${r.target_price}`, r.deliver_by && `by ${fmtDate(r.deliver_by)}`].filter(Boolean).join(', ')}>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      {sp.accepted && <div className="ok" role="status">Quote accepted. The supplier is revealed below and an order is open. Our team will confirm it with you.</div>}
      <Stages current={r.stage} />
      {r.stage === 'Closed' && <div className="note">Closed{r.closed_reason ? `: ${r.closed_reason}` : ''}.</div>}
      <div className="split">
        <div className="stack">
          <Step n={1} s="Product request">
            <table className="tbl"><tbody>
              <tr><td>Molecule</td><td>{r.molecule}</td></tr>
              <tr><td>Quantity</td><td>{r.quantity ? `${r.quantity}${r.unit ? ' ' + r.unit : ''}` : 'Not given'}</td></tr>
              {r.target_price && <tr><td>Target price</td><td>{r.target_price}</td></tr>}
              {r.deliver_by && <tr><td>Needed by</td><td>{fmtDate(r.deliver_by)}</td></tr>}
              {r.notes && <tr><td>Notes</td><td style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</td></tr>}
            </tbody></table>
          </Step>
          {ev && (
            <section className="card">
              <div className="card-h"><h2>Our assessment</h2><span className={`pill ${VERDICT[ev.verdict].cls}`}>{VERDICT[ev.verdict].label}</span></div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{ev.summary}</p>
              <span className="note">Updated {fmtDate(ev.evaluated_at)}.{ev.verdict === 'no' ? ' Reply below if you still want us to go ahead.' : ''}</span>
            </section>)}
          <Step n={2} s="Regulatory check">
            {ev?.regulatory_check ? <p style={{ whiteSpace: 'pre-wrap' }}>{ev.regulatory_check}</p>
              : <Empty>We check who already holds a registration, its status and any restriction. Usually within two working days.</Empty>}
          </Step>
          <Step n={3} s="Regulatory analysis">
            {ev?.route ? <p style={{ whiteSpace: 'pre-wrap' }}>{ev.route}</p> : <Empty>The registration route, requirements and timeline appear here.</Empty>}
          </Step>
          <section className="card">
            <div className="card-h"><h2>Dossier readiness</h2><span className="note">For registration</span></div>
            <p className="note" style={{ marginBottom: 10 }}>What the supplier&apos;s registration dossier holds, item by item, and whether a bioequivalence study is needed.</p>
            {d.items.length === 0 && !d.dossier ? <Empty>We check the dossier once a supplier is lined up.</Empty>
              : <DossierReadiness be={d.dossier?.be_status} beNote={d.dossier?.be_note} items={d.items} />}
          </section>
          <section className="card">
            <div className="card-h"><h2>4. Pricing and logistics</h2>{state('Pricing and logistics') && <span className={`pill ${state('Pricing and logistics') === 'Now' ? 'solid' : state('Pricing and logistics') === 'Done' ? 'mint' : ''}`}>{state('Pricing and logistics')}</span>}</div>
            <p className="note" style={{ marginBottom: 10 }}>{STAGE_INFO['Pricing and logistics']}</p>
            {(ev?.price_range || ev?.supply) && <table className="tbl" style={{ marginBottom: 12 }}><tbody>
              {ev?.price_range && <tr><td>Indicative price</td><td>{ev.price_range}</td></tr>}
              {ev?.supply && <tr><td>Supply and lead time</td><td>{ev.supply}</td></tr>}
            </tbody></table>}
            {d.quotes.length === 0 && <Empty>No quotes yet. We will post them here when suppliers are found.</Empty>}
            <div className="stack" style={{ gap: 12 }}>{d.quotes.map((q) => (
              <div key={q.id} className="card tight" style={{ borderColor: q.accepted ? 'var(--blue)' : undefined }}>
                <div className="between" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <b className="nm">{q.accepted && d.revealed ? d.revealed.supplier_name : q.label}</b>
                    {q.accepted && d.revealed && <span className="sub2"> ({q.label}{d.revealed.supplier_country ? `, ${d.revealed.supplier_country}` : ''})</span>}
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {q.accepted && d.revealed?.price != null ? `Price: ${d.revealed.currency} ${Number(d.revealed.price).toFixed(2)}${d.revealed.unit ? ' per ' + d.revealed.unit : ''} · ` : ''}
                      MOQ: {q.moq || '—'} · Lead time: {q.lead_time_weeks ? `${q.lead_time_weeks} weeks` : '—'} · Certs: {q.certs || '—'}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      {!q.accepted && q.price_vs_target && <span className={`pill ${q.price_vs_target === 'above' ? 'peach' : 'mint'}`}>{PVT[q.price_vs_target]}</span>}
                      <QuoteTerms q={q} /></div>
                    {q.accepted && d.revealed?.contact && <div className="small" style={{ marginTop: 4 }}>Contact: {d.revealed.contact}</div>}
                  </div>
                  {q.accepted ? <span className="pill solid">Accepted</span> : canAccept && (
                    <form action={acceptQuote}><input type="hidden" name="request_id" value={id} /><input type="hidden" name="quote_id" value={q.id} />
                      <button className="btn btn-blue btn-sm" type="submit">Accept</button></form>)}
                </div>
              </div>))}</div>
            <p className="note" style={{ marginTop: 12 }}>Quotes are anonymous. Accepting one reveals the supplier and its price, and moves the product to registration.</p>
          </section>
          <Step n={5} s="Registration">
            {['Registration', 'Shipment'].includes(r.stage) ? <p>We prepare the dossier with your chosen supplier and follow it through to approval. Updates arrive in the messages here.</p>
              : <Empty>Starts once you accept a quote.</Empty>}
          </Step>
          <Step n={6} s="Shipment">
            {d.order && r.stage === 'Shipment' ? <ShipmentTrack status={d.order.status} eta={d.order.eta} docs={d.docs} />
              : <Empty>Starts once the product is registered.</Empty>}
          </Step>
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Messages with Nazryx</h2></div>
            <div className="stack" style={{ gap: 8 }}>
              {d.messages.length === 0 && <Empty>Our team will reach out to you here for more info.</Empty>}
              {d.messages.map((m, i) => <div key={i} className={`msg ${m.from_team ? 'team' : 'me'}`}><b>{m.from_team ? 'Nazryx' : 'You'}:</b> {m.body}
                <div className="tiny muted">{fmtDate(m.created_at)}</div></div>)}
            </div>
            <form action={postMessage} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="request_id" value={id} />
              <label className="sr" htmlFor="body">Write a message</label>
              <input className="input" id="body" name="body" placeholder="Write a message" style={{ flex: '1 1 240px' }} required />
              <button className="btn btn-blue btn-sm" type="submit">Send</button>
            </form>
          </section>
        <section className="card">
          <div className="card-h"><h2>Attachments</h2></div>
          <div className="stack" style={{ gap: 8 }}>
            {d.files.length === 0 && <Empty>No files yet.</Empty>}
            {d.files.map((f) => <a key={f.id} href={`/files/request/${f.id}`}>{f.file_name}{f.kind === 'requirement_list' ? ' (requirement list)' : ''}</a>)}
          </div>
          <form action={addRequestFile} className="stack" style={{ marginTop: 14 }}>
            <input type="hidden" name="request_id" value={id} />
            <label className="lbl" htmlFor="file">Add file</label>
            <input id="file" name="file" type="file" required />
            <button className="btn btn-ghost btn-sm" type="submit">Upload</button>
          </form>
          <p className="note" style={{ marginTop: 12 }}>Documents live only inside requests.</p>
        </section>
        </div>
      </div>
    </Shell>
  );
}
