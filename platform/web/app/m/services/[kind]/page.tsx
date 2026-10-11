import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { targetMarkets } from '@/components/MarketPicker';
import { Flash, PlanLock } from '@/components/ui';
import { orderReport, requestService } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { EAC, MFR_COUNTRIES, NEEDS_PLAN, REPORT_TYPES, SERVICES, SERVICE_NEEDS, canUse } from '@/lib/mfr';

export const metadata = { title: 'Service' };

// One service: what it is, how it runs, what we need, then the form (or the plan that unlocks it).
export default async function Service({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ product?: string; country?: string; error?: string; type?: string }> }) {
  const { kind } = await params;
  const sp = await searchParams;
  if (!SERVICES[kind]) notFound();
  const u = await requireUser({ manufacturer: true });
  const s = SERVICES[kind];
  const d = await withUser(u.id, async (db) => ({
    targets: targetMarkets((await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.id]))?.target_countries),
    products: await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                              where p.user_id = $1 order by 2 limit 300`, [u.id]),
  }));
  const ok = canUse(u.mfr_tier, kind);
  const country = sp.country && MFR_COUNTRIES.some((c) => c.code === sp.country) ? sp.country : d.targets[0];
  const countries = [...MFR_COUNTRIES.filter((c) => d.targets.includes(c.code)), ...MFR_COUNTRIES.filter((c) => !d.targets.includes(c.code))];
  const fields = (
    <div className="form-grid">
      <div className="field"><label htmlFor="country">Market</label>
        <select className="input" id="country" name="country" defaultValue={country}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor="product_id">Product</label>
        <select className="input" id="product_id" name="product_id" defaultValue={sp.product ?? ''}>
          <option value="">Several or all products</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div className="field full"><label htmlFor="detail">{kind === 'report' ? 'What should the report answer?' : 'Anything we should know?'} <span className="note">(optional)</span></label>
        <textarea className="input" id="detail" name="detail" rows={3} /></div>
    </div>);
  return (
    <Shell user={u} title={s.label} crumb={<><Link href="/m/services">Services</Link> / {s.label}</>} sub={s.what}>
      <Flash sp={sp} />
      <div className="split">
        <section className="card stack">
          {!ok ? <PlanLock need={NEEDS_PLAN[kind]} title={s.label}>{s.what}</PlanLock>
            : kind === 'partner_intro' ? (<>
              <h2>Pick the distributor first</h2>
              <p className="muted">Find the distributor in Partners, then press &ldquo;Request introduction&rdquo; on its profile. We take it from there.</p>
              <Link className="btn btn-blue" href="/m/partners" style={{ alignSelf: 'flex-start' }}>Open Partners</Link>
            </>) : kind === 'report' ? (
              <form action={orderReport} className="stack">
                <h2>Order a report</h2>
                <div className="stack" style={{ gap: 8 }}>{REPORT_TYPES.map(([k, l], i) => (
                  <label key={k} className="choice"><input type="radio" name="report_type" value={k} defaultChecked={sp.type ? sp.type === k : i === 0} /><span>{l}</span></label>))}</div>
                {fields}
                <button className="btn btn-blue" type="submit" style={{ alignSelf: 'flex-start' }}>Order report</button>
                <p className="note">In your portal within 24 hours. Our team confirms the price before starting.</p>
              </form>
            ) : (
              <form action={requestService} className="stack">
                <h2>Ask for {s.label.toLowerCase()}</h2>
                <input type="hidden" name="kind" value={kind} /><input type="hidden" name="return" value={`/m/services/${kind}`} />
                {fields}
                <button className="btn btn-blue" type="submit" style={{ alignSelf: 'flex-start' }}>Send to our team</button>
                <p className="note">We reply within one working day with the scope. Nothing is charged until you agree it.</p>
              </form>)}
        </section>
        <div className="stack">
          <section className="card stack">
            <h2>How it runs</h2>
            <ol className="steps">{s.milestones.slice(1).map((m, i) => <li key={m}><em>{String(i + 1).padStart(2, '0')}</em><span>{m}</span></li>)}</ol>
            {kind === 'eac_rollout' && <p className="note">Covers {EAC.join(', ')}.</p>}
          </section>
          {SERVICE_NEEDS[kind] && (
            <section className="card stack">
              <h2>What we need from you</h2>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{SERVICE_NEEDS[kind].map((n) => <li key={n}>{n}</li>)}</ul>
            </section>)}
        </div>
      </div>
    </Shell>
  );
}
