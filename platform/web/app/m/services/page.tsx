import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, StagePill } from '@/components/ui';
import { orderReport, requestService } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { AGENCY_KINDS, EAC, MFR_COUNTRIES, REPORT_TYPES, SERVICES, countryName } from '@/lib/mfr';

export const metadata = { title: 'Services' };

// The agency side: everything the Nazryx team does for a manufacturer, as engagements with visible milestones.
export default async function Services({ searchParams }: { searchParams: Promise<{ product?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => ({
    engagements: await rows(db, `select e.id, e.kind, e.country, e.stage, e.status, e.due_at, e.created_at, e.report_type,
                                   coalesce(m.inn, p.name) as product
                                 from engagements e left join mfr_products p on p.id = e.product_id left join molecules m on m.id = p.molecule_id
                                 where e.user_id = $1 order by (e.status = 'open') desc, e.updated_at desc`, [u.id]),
    products: await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                              where p.user_id = $1 order by 2 limit 300`, [u.id]),
  }));
  const countrySelect = (name = 'country') => (
    <select className="input" name={name} aria-label="Country" defaultValue="TZ" style={{ flex: '1 1 140px' }}>
      {MFR_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>);
  const productSelect = (
    <select className="input" name="product_id" aria-label="Product" defaultValue={sp.product ?? ''} style={{ flex: '1 1 180px' }}>
      <option value="">Any or several products</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>);
  return (
    <Shell user={u} title="Services" sub="Our team takes your products into new markets">
      <Flash sp={sp} />
      <section className="card">
        <div className="card-h"><h2>Your engagements</h2></div>
        {d.engagements.length === 0 ? <Empty>Nothing yet. Pick a service below, or order a 24-hour report.</Empty> : (
          <div className="stack" style={{ gap: 10 }}>{d.engagements.map((e) => (
            <Link key={e.id} href={`/m/engagements/${e.id}`} className="between">
              <span><b>{SERVICES[e.kind].label}</b>{e.product ? ` · ${e.product}` : ''}{e.country ? ` · ${countryName(e.country)}` : ''}
                <span className="sub2"> · {e.kind === 'report' && e.stage !== 'Delivered' && e.due_at ? `due ${fmtDate(e.due_at)}` : `since ${fmtDate(e.created_at)}`}</span></span>
              <StagePill stage={e.status === 'open' ? e.stage : e.status === 'done' ? 'Closed' : 'Cancelled'} /></Link>))}</div>)}
      </section>

      <div className="grid g2">
        {AGENCY_KINDS.map((k) => (
          <section key={k} className="card stack">
            <h2>{SERVICES[k].label}</h2>
            <p className="muted">{SERVICES[k].what}</p>
            {k === 'eac_rollout' && <p className="note">Countries: {EAC.join(', ')}.</p>}
            <p className="note">Milestones: {SERVICES[k].milestones.slice(1).join(' → ')}</p>
            <form action={requestService} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="kind" value={k} />
              <div className="row">{countrySelect()}{productSelect}</div>
              <textarea className="input" name="detail" aria-label="What you need" placeholder="What you need, in a line or two (optional)" rows={2} />
              <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Request {SERVICES[k].label.toLowerCase()}</button>
            </form>
          </section>))}
        <section className="card stack" id="report">
          <h2>24-hour report</h2>
          <p className="muted">A written report from our team, in your portal within 24 hours of ordering.</p>
          <form action={orderReport} className="stack" style={{ gap: 8 }}>
            {REPORT_TYPES.map(([k, l], i) => (
              <label key={k} className="choice"><input type="radio" name="report_type" value={k} defaultChecked={i === 0} /><span>{l}</span></label>))}
            <div className="row">{countrySelect()}{productSelect}</div>
            <textarea className="input" name="detail" aria-label="Anything we should know" placeholder="Anything we should know (optional)" rows={2} />
            <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Order report</button>
          </form>
        </section>
      </div>
      <p className="note">Services are quoted and invoiced by our team; ordering starts the conversation, not a charge.</p>
    </Shell>
  );
}
