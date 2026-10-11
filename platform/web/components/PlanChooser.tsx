import { choosePlan } from '@/app/actions/mfr';
import { MFR_PLANS, PLAN_ORDER, countryName, suggestPlan, type PlanKey } from '@/lib/mfr';

export type PlanPrices = Record<string, { price: string | null; note: string | null }>;
export async function loadPlanPrices(db: any): Promise<PlanPrices> {
  const r = await db.query('select key, price, note from plan_prices');
  return Object.fromEntries(r.rows.map((x: any) => [x.key, { price: x.price, note: x.note }]));
}
const ON_SCOPE = 'Priced on your scope';

// Every line of the three plans, and the lowest plan that has it.
const COMPARE: [string, PlanKey][] = [
  ['Complete market data', 'data'], ['Target distributor lists', 'data'], ['Portfolio analysis', 'data'],
  ['Distributor portfolio matching, and the potential to supply them', 'access'], ['Pricing analysis', 'access'],
  ['Documentation and regulatory check', 'access'], ['Pathway to approval', 'access'],
  ['Distributor sourcing, done for you', 'entry'], ['Regulatory submissions and approvals, done for you', 'entry'],
  ['Sales forecasts and strategic review', 'entry'], ['Launch planned with the distributor’s sales team', 'entry'],
  ['Market watch: new registrations, competitors, renewals', 'entry'], ['One contact and weekly reports per market', 'entry'],
];
const rank = (k: PlanKey) => PLAN_ORDER.indexOf(k);

/** The three plans with the one that fits marked, a side-by-side comparison, and what happens after choosing. */
export default function PlanChooser({ p, prices, products, from, want }: {
  p: any; prices: PlanPrices; products: number; from: 'onboarding' | 'plan'; want?: PlanKey | null;
}) {
  const s = suggestPlan(p);
  const active: PlanKey | null = p.active_plan ?? null;
  const markets = (p.target_countries ?? []).map(countryName);
  const highlight = want ?? s.plan;
  return (
    <div className="stack">
      {want ? (
        <section className="card stack" style={{ borderColor: 'var(--blue)' }}>
          <span className="lbl">To unlock that</span>
          <h2 style={{ fontSize: 24 }}>{MFR_PLANS[want].name}</h2>
          <p className="muted">{MFR_PLANS[want].for} It also includes everything below it.</p>
        </section>
      ) : active ? (
        <section className="card stack">
          <span className="lbl">Your plan</span>
          <h2 style={{ fontSize: 24 }}>{MFR_PLANS[active].name}</h2>
          <p className="muted">Active{p.active_since ? ` since ${new Date(p.active_since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
            {active !== 'entry' ? ' Move up whenever you are ready; our team switches it over.' : ' You have every part of Nazryx working for you.'}</p>
        </section>
      ) : (
        <section className="card stack">
          <span className="lbl">Suggested for {p.company_name}</span>
          <h2 style={{ fontSize: 24 }}>{MFR_PLANS[s.plan].name}</h2>
          <p>Because {s.why.join(', ')}.</p>
          <p className="note">From your answers: {markets.length ? markets.join(', ') : 'no markets yet'} · {products} product{products === 1 ? '' : 's'} in your catalogue.</p>
        </section>)}

      <div className="grid g3">
        {PLAN_ORDER.map((k) => {
          const pl = MFR_PLANS[k], pr = prices[`mfr_${k}`], on = k === highlight, isActive = k === active, asked = p.chosen_plan === k && !isActive;
          return (
            <form key={k} action={choosePlan} className="card stack" style={on ? { borderColor: 'var(--blue)', borderWidth: 2 } : undefined}>
              <input type="hidden" name="plan" value={k} /><input type="hidden" name="from" value={from} />
              <div className="between" style={{ alignItems: 'flex-start' }}><h2>{pl.name}</h2>
                {isActive ? <span className="pill solid">Your plan</span> : asked ? <span className="pill blue">Requested</span>
                  : on ? <span className="pill blue">{want ? 'Unlocks it' : 'Suggested'}</span> : null}</div>
              <div><b className="num" style={{ fontSize: 20 }}>{pr?.price || ON_SCOPE}</b>{pr?.note && <div className="sub2">{pr.note}</div>}</div>
              <p className="muted">{pl.for}</p>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pl.includes.map((i) => <li key={i}>{i}</li>)}</ul>
              {isActive ? <span className="note" style={{ marginTop: 'auto' }}>Active now.</span>
                : active && rank(k) < rank(active) ? <span className="note" style={{ marginTop: 'auto' }}>Included in your plan.</span>
                : <button className={`btn ${on ? 'btn-blue' : 'btn-ghost'}`} type="submit" style={{ marginTop: 'auto' }}>
                    {asked ? 'Ask again' : active ? `Move up to ${pl.name}` : `Choose ${pl.name}`}</button>}
            </form>);
        })}
      </div>

      <section className="card">
        <div className="card-h"><h2>Compare the plans</h2><span className="note">24-hour reports can be ordered on any plan</span></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>What you get</th>{PLAN_ORDER.map((k) => <th key={k} className="r">{MFR_PLANS[k].name}</th>)}</tr></thead>
          <tbody>{COMPARE.map(([label, min]) => (
            <tr key={label}><td>{label}</td>{PLAN_ORDER.map((k) => (
              <td key={k} className="r">{rank(k) >= rank(min) ? <b style={{ color: 'var(--blue-txt)' }} aria-label="Included">✓</b> : <span className="muted" aria-label="Not included">—</span>}</td>))}</tr>))}
          </tbody></table></div>
      </section>

      <div className="grid g3">
        <section className="card stack"><span className="lbl">01</span><h2>You choose</h2>
          <p className="muted">Nothing is charged here. Your choice goes to our team with your answers.</p></section>
        <section className="card stack"><span className="lbl">02</span><h2>We confirm</h2>
          <p className="muted">Within one working day: the scope for your markets and products, and the price. Government fees are always yours, at cost.</p></section>
        <section className="card stack"><span className="lbl">03</span><h2>It unlocks</h2>
          <p className="muted">Once agreed, we switch your plan on and every screen and service in it opens straight away.</p></section>
      </div>

      {from === 'onboarding' && (
        <form action={choosePlan} className="row"><input type="hidden" name="plan" value="" /><input type="hidden" name="from" value={from} />
          <button className="btn btn-ghost" type="submit">Explore the portal first</button>
          <span className="note">You can pick a plan any time under Plan.</span></form>)}
    </div>
  );
}
