import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, StagePill } from '@/components/ui';
import { orderReport, requestService } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { AGENCY_KINDS, EAC, MFR_COUNTRIES, MFR_PLANS, REPORT_TYPES, SERVICES, countryName, recommendServices } from '@/lib/mfr';

export const metadata = { title: 'Services' };

// Services offered from what the manufacturer told us: the ones that fit first, with the reason; the rest folded away.
export default async function Services({ searchParams }: { searchParams: Promise<{ product?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => ({
    p: await one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]),
    engagements: await rows(db, `select e.id, e.kind, e.country, e.stage, e.status, e.due_at, e.created_at, e.report_type,
                                   coalesce(m.inn, p.name) as product
                                 from engagements e left join mfr_products p on p.id = e.product_id left join molecules m on m.id = p.molecule_id
                                 where e.user_id = $1 order by (e.status = 'open') desc, e.updated_at desc`, [u.id]),
    products: await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                              where p.user_id = $1 order by 2 limit 300`, [u.id]),
  }));
  const targets: string[] = d.p?.target_countries?.length ? d.p.target_countries : ['TZ'];
  const open = new Set(d.engagements.filter((e) => e.status === 'open').map((e) => e.kind));
  const recs = recommendServices(d.p).filter((r) => r.kind === 'report' || !open.has(r.kind)).slice(0, 3);
  const rest = [...AGENCY_KINDS, 'partner_intro'].filter((k) => !recs.some((r) => r.kind === k));
  const plan = d.p?.chosen_plan ?? d.p?.suggested_plan;

  // the markets they picked first, then the others
  const countries = [...MFR_COUNTRIES.filter((c) => targets.includes(c.code)), ...MFR_COUNTRIES.filter((c) => !targets.includes(c.code))];
  const countrySelect = (
    <select className="input" name="country" aria-label="Country" defaultValue={targets[0]} style={{ flex: '1 1 140px' }}>
      {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>);
  const productSelect = (
    <select className="input" name="product_id" aria-label="Product" defaultValue={sp.product ?? ''} style={{ flex: '1 1 180px' }}>
      <option value="">Any or several products</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>);
  const ServiceForm = ({ kind }: { kind: string }) => kind === 'partner_intro' ? (
    <Link className="btn btn-blue btn-sm" href="/m/partners" style={{ alignSelf: 'flex-start' }}>Open the partner finder</Link>
  ) : (
    <form action={requestService} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="kind" value={kind} />
      <div className="row">{countrySelect}{productSelect}</div>
      <textarea className="input" name="detail" aria-label="What you need" placeholder="What you need, in a line or two (optional)" rows={2} />
      <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Request {SERVICES[kind].label.toLowerCase()}</button>
    </form>);
  const ReportForm = ({ type }: { type?: string }) => (
    <form action={orderReport} className="stack" style={{ gap: 8 }}>
      {REPORT_TYPES.map(([k, l], i) => (
        <label key={k} className="choice"><input type="radio" name="report_type" value={k} defaultChecked={type ? k === type : i === 0} /><span>{l}</span></label>))}
      <div className="row">{countrySelect}{productSelect}</div>
      <textarea className="input" name="detail" aria-label="Anything we should know" placeholder="Anything we should know (optional)" rows={2} />
      <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Order report</button>
    </form>);

  return (
    <Shell user={u} title="Services" sub={plan ? `Picked for you, from your answers and the ${MFR_PLANS[plan as keyof typeof MFR_PLANS]?.name ?? ''} plan` : 'Picked for you, from your answers'}
      actions={<Link className="btn btn-ghost btn-sm" href="/m/onboarding?step=5">Change what you need</Link>}>
      <Flash sp={sp} />
      <div className="split">
        <div className="stack">
          <h2>Recommended for you</h2>
          {recs.map((r) => (
            <section key={r.kind} className="card stack" id={r.kind === 'report' ? 'report' : undefined}>
              <div className="between"><h2>{r.kind === 'report' ? '24-hour report' : SERVICES[r.kind].label}</h2><span className="pill blue">For you</span></div>
              <p className="muted">{r.kind === 'report' ? 'A written report from our team, in your portal within 24 hours.' : SERVICES[r.kind].what}</p>
              <p className="note">Because {r.why}.{r.kind === 'eac_rollout' ? ` Covers ${EAC.join(', ')}.` : ''}</p>
              {r.kind === 'report' ? <ReportForm type={r.report} /> : <>
                {r.kind !== 'partner_intro' && <p className="note">Milestones: {SERVICES[r.kind].milestones.slice(1).join(' → ')}</p>}
                <ServiceForm kind={r.kind} /></>}
            </section>))}
          {rest.length > 0 && (
            <section className="card stack">
              <h2>Something else?</h2>
              {rest.map((k) => (
                <details key={k} className="stack">
                  <summary className="btn-link">{SERVICES[k].label}</summary>
                  <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                    <p className="muted">{SERVICES[k].what}</p>
                    <ServiceForm kind={k} />
                  </div>
                </details>))}
              {!recs.some((r) => r.kind === 'report') && (
                <details id="report"><summary className="btn-link">24-hour report</summary><div style={{ marginTop: 10 }}><ReportForm /></div></details>)}
            </section>)}
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Your engagements</h2></div>
            {d.engagements.length === 0 ? <Empty>Nothing yet. Start with one of the services picked for you.</Empty> : (
              <div className="stack" style={{ gap: 10 }}>{d.engagements.map((e) => (
                <Link key={e.id} href={`/m/engagements/${e.id}`} className="between">
                  <span><b>{SERVICES[e.kind].label}</b>{e.product ? ` · ${e.product}` : ''}{e.country ? ` · ${countryName(e.country)}` : ''}
                    <span className="sub2"> · {e.kind === 'report' && e.stage !== 'Delivered' && e.due_at ? `due ${fmtDate(e.due_at)}` : `since ${fmtDate(e.created_at)}`}</span></span>
                  <StagePill stage={e.status === 'open' ? e.stage : e.status === 'done' ? 'Closed' : 'Cancelled'} /></Link>))}</div>)}
          </section>
          <p className="note">Services are quoted and invoiced by our team; asking starts the conversation, not a charge.</p>
        </div>
      </div>
    </Shell>
  );
}
