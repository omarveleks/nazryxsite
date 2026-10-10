import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Empty, Stages } from '@/components/ui';
import { acceptQuote, addRequestFile, postMessage } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';

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
      quotes: await rows(db, 'select id, label, moq, lead_time_weeks, certs, price_vs_target, accepted from quotes where request_id = $1 order by label', [id]),
      revealed: await one(db, 'select * from accepted_supplier where request_id = $1', [id]),
      files: await rows(db, 'select id, file_name, kind, created_at from request_files where request_id = $1 order by created_at', [id]),
      messages: await rows(db, 'select from_team, body, created_at from request_messages where request_id = $1 order by created_at', [id]),
      order: await one(db, 'select id, status, updated_at from orders where request_id = $1', [id]),
    };
  });
  if (!d) notFound();
  const { r } = d;
  const canAccept = r.stage !== 'Closed' && !d.quotes.some((q) => q.accepted);
  return (
    <Shell user={u} title={`Request: ${r.molecule}`} crumb={<><Link href="/requests">Requests</Link> / {r.molecule}</>}
      sub={[r.quantity && `Quantity ${r.quantity}${r.unit ? ' ' + r.unit : ''}`, r.target_price && `target price ${r.target_price}`, r.deliver_by && `by ${fmtDate(r.deliver_by)}`].filter(Boolean).join(', ')}>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      {sp.accepted && <div className="ok" role="status">Quote accepted. The supplier is revealed below and an order is open. Our team will confirm it with you.</div>}
      <Stages current={r.stage} />
      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Quotes</h2>{d.order && <span className="pill blue">Order {d.order.id}: {d.order.status}</span>}</div>
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
                    {!q.accepted && q.price_vs_target && <span className={`pill ${q.price_vs_target === 'above' ? 'peach' : 'mint'}`} style={{ marginTop: 6 }}>{PVT[q.price_vs_target]}</span>}
                    {q.accepted && d.revealed?.contact && <div className="small" style={{ marginTop: 4 }}>Contact: {d.revealed.contact}</div>}
                  </div>
                  {q.accepted ? <span className="pill solid">Accepted</span> : canAccept && (
                    <form action={acceptQuote}><input type="hidden" name="request_id" value={id} /><input type="hidden" name="quote_id" value={q.id} />
                      <button className="btn btn-blue btn-sm" type="submit">Accept</button></form>)}
                </div>
              </div>))}</div>
            <p className="note" style={{ marginTop: 12 }}>Quotes are anonymous. Accepting a quote reveals the supplier and its price, and opens an order.</p>
          </section>
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
        </div>
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
    </Shell>
  );
}
