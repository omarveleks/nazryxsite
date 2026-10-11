import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { EngagementBody, loadEngagement } from '@/components/EngagementView';
import { addObligation, reviewEngagementFile, setEngagementStage, toggleObligation } from '@/app/actions/admin';
import { deleteEngagementDoc, uploadEngagementDoc } from '@/app/actions/docs';
import { ENGAGEMENT_DOC_ITEMS } from '@/lib/docs';
import { requireTeam } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { DOSSIER_ITEMS, fmtDate, title } from '@/lib/format';
import { MFR_COUNTRIES, OBLIGATION_KINDS, SERVICES, countryName } from '@/lib/mfr';

export default async function AdminEngagement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; uploaded?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireTeam('manufacturers');
  const d = await withUser(u.id, async (db) => {
    const base = await loadEngagement(db, id);
    if (!base) return null;
    // partner introductions: which company the profile code stands for (team only)
    const code = /profile ([0-9A-F]{8})/.exec(base.e.detail ?? '')?.[1] ?? null;
    const partner = code ? await one(db, `select c.id, c.display_name from companies c where c.id = partner_company($1)`, [code]) : null;
    const products = await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                                     where p.user_id = $1 order by 2`, [base.e.user_id]);
    return { ...base, partner, products };
  });
  if (!d) notFound();
  const { e } = d;
  const client = d.files.filter((f) => !f.from_team);
  return (
    <Shell user={u} title={`#${id} ${SERVICES[e.kind].label}`} crumb={<><Link href="/admin?tab=manufacturers">Admin / Manufacturers</Link> / #{id}</>}
      sub={`${e.company_name || e.email} (${e.email})${e.country ? ` · ${countryName(e.country)}` : ''}`}>
      <Flash sp={sp} />
      <section className="card stack">
        <h2>Team controls</h2>
        <form action={setEngagementStage} className="row">
          <input type="hidden" name="engagement_id" value={id} />
          <select className="input" name="stage" defaultValue={e.stage} aria-label="Stage" style={{ flex: '0 1 240px' }}>
            {SERVICES[e.kind].milestones.map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input" name="status" defaultValue={e.status} aria-label="Status" style={{ flex: '0 1 160px' }}>
            <option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select>
          <button className="btn btn-blue btn-sm" type="submit">Update</button>
        </form>
        {/profile [0-9A-F]{8}/.test(e.detail ?? '') && (
          <p className="note">Profile stands for: {d.partner ? <Link href={`/company/${d.partner.id}`}><b>{title(d.partner.display_name)}</b></Link> : 'not found (the registry may have changed)'}. Never share the name until both sides agree.</p>)}
        <form action={uploadEngagementDoc} className="row">
          <input type="hidden" name="engagement_id" value={id} />
          <select className="input" name="item" defaultValue={e.kind === 'report' ? 'report' : 'other'} aria-label="Document type" style={{ flex: '0 1 240px' }}>
            {ENGAGEMENT_DOC_ITEMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input name="file" type="file" required aria-label="File" />
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="internal" /> Internal (team only)</label>
          <button className="btn btn-ghost btn-sm" type="submit">Upload</button>
        </form>
        {d.files.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>{d.files.map((f) => (
            <div key={f.id} className="between small"><span><a href={`/files/engagement/${f.id}`}>{f.file_name}</a>
              <span className="sub2"> · {ENGAGEMENT_DOC_ITEMS.find(([k]) => k === f.item)?.[1] ?? f.item} · {f.from_team ? 'Nazryx' : 'Client'}</span></span>
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>{f.internal && <span className="pill peach">Internal</span>}
                <form action={deleteEngagementDoc}><input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="file_id" value={f.id} />
                  <button className="btn btn-ghost btn-sm" type="submit">Remove</button></form></span></div>))}</div>)}
        {e.kind === 'report' && e.due_at && <p className="note">Due {fmtDate(e.due_at)}. After uploading the report, set the stage to Delivered.</p>}
      </section>

      {client.length > 0 && (
        <section className="card stack">
          <h2>Review the client&apos;s documents</h2>
          {client.map((f) => (
            <form key={f.id} action={reviewEngagementFile} className="row">
              <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="file_id" value={f.id} />
              <a href={`/files/engagement/${f.id}`} style={{ flex: '1 1 220px' }}>{f.file_name}<span className="sub2"> · {DOSSIER_ITEMS.find(([k]) => k === f.item)?.[1] ?? f.item}</span></a>
              <select className="input" name="review" defaultValue={f.review} aria-label="Review" style={{ flex: '0 1 140px' }}>
                <option value="submitted">Not reviewed</option><option value="accepted">Accepted</option><option value="gap">Gap</option></select>
              <input className="input" name="comment" defaultValue={f.team_comment ?? ''} placeholder="Comment for the client" aria-label="Comment" style={{ flex: '1 1 200px' }} />
              <button className="btn btn-ghost btn-sm" type="submit">Save</button>
            </form>))}
        </section>)}

      {e.kind === 'post_registration' && (
        <section className="card stack">
          <h2>Deadlines</h2>
          {d.obligations.map((o) => (
            <form key={o.id} action={toggleObligation} className="between">
              <input type="hidden" name="engagement_id" value={id} /><input type="hidden" name="obligation_id" value={o.id} />
              <span>{OBLIGATION_KINDS[o.kind]}{o.product ? ` · ${o.product}` : ''} · {countryName(o.country)} · {fmtDate(o.due_date)}</span>
              <button className="btn btn-ghost btn-sm" type="submit">{o.done ? 'Reopen' : 'Mark done'}</button>
            </form>))}
          <form action={addObligation} className="form-grid">
            <input type="hidden" name="engagement_id" value={id} />
            <select className="input" name="kind" aria-label="Type" defaultValue="renewal">{Object.entries(OBLIGATION_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className="input" type="date" name="due_date" aria-label="Due date" required />
            <select className="input" name="product_id" aria-label="Product" defaultValue=""><option value="">No product</option>
              {d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className="input" name="country" aria-label="Country" defaultValue={e.country ?? 'TZ'}>{MFR_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
            <input className="input full" name="note" placeholder="Note" aria-label="Note" />
            <button className="btn btn-blue btn-sm full" type="submit">Add deadline</button>
          </form>
        </section>)}

      <EngagementBody e={e} files={d.files} messages={d.messages} obligations={d.obligations} team />
    </Shell>
  );
}
