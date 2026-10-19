import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { targetMarkets } from '@/components/MarketPicker';
import { Flash, PlanLock } from '@/components/ui';
import { requestService } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { AGENCY_KINDS, MFR_COUNTRIES, NEEDS_PLAN, SERVICES, SERVICE_NEEDS, canUse } from '@/lib/mfr';

export const metadata = { title: 'Service' };

// One service: what it is, how it runs, what we need, then the form (or the plan that unlocks it).
export default async function Service({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ product?: string; country?: string; error?: string }> }) {
  const { kind } = await params;
  const sp = await searchParams;
  if (!(AGENCY_KINDS as readonly string[]).includes(kind)) notFound();
  const u = await requireUser({ manufacturer: true });
  const s = SERVICES[kind];
  const d = await withUser(u.id, async (db) => ({
    targets: targetMarkets((await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.id]))?.target_countries, u.mfr_markets),
    products: await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                              where p.user_id = $1 order by 2 limit 300`, [u.id]),
  }));
  const ok = canUse(u.mfr_tier, kind);
  const country = sp.country && MFR_COUNTRIES.some((c) => c.code === sp.country) ? sp.country : d.targets[0];
  const countries = [...MFR_COUNTRIES.filter((c) => d.targets.includes(c.code)), ...MFR_COUNTRIES.filter((c) => c.core && !d.targets.includes(c.code))];
  return (
    <Shell user={u} title={s.label} crumb={<><Link href="/m/services">Services</Link> / {s.label}</>} sub={s.what}>
      <Flash sp={sp} />
      <div className="split">
        <section className="card stack">
          {!ok ? <PlanLock need={NEEDS_PLAN[kind]} title={s.label}>{s.what}</PlanLock> : (
            <form action={requestService} className="stack">
              <h2>Tell us where to start</h2>
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="return" value={`/m/services/${kind}`} />
              <div className="form-grid">
                <div className="field"><label htmlFor="country">Market</label>
                  <select className="input" id="country" name="country" defaultValue={country}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
                <div className="field"><label htmlFor="product_id">Product</label>
                  <select className="input" id="product_id" name="product_id" defaultValue={sp.product ?? ''}>
                    <option value="">Several or all products</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div className="field full"><label htmlFor="detail">Anything we should know? <span className="note">(optional)</span></label>
                  <textarea className="input" id="detail" name="detail" rows={3} /></div>
              </div>
              <button className="btn btn-blue" type="submit" style={{ alignSelf: 'flex-start' }}>Send to our team</button>
              <p className="note">We reply within one working day with the scope.</p>
            </form>)}
        </section>
        <div className="stack">
          <section className="card stack">
            <h2>How it runs</h2>
            <ol className="steps">{s.milestones.slice(1).map((m, i) => <li key={m}><em>{String(i + 1).padStart(2, '0')}</em><span>{m}</span></li>)}</ol>
          </section>
          <section className="card stack">
            <h2>What we need from you</h2>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{SERVICE_NEEDS[kind].map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        </div>
      </div>
    </Shell>
  );
}
