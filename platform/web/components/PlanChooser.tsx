import { choosePlan, openBillingPortal, startCheckout } from '@/app/actions/mfr';
import { stripeReady } from '@/lib/stripe';
import Link from 'next/link';
import { MFR_COUNTRIES, MFR_PLANS, PLAN_ORDER, countryName, suggestPlan, yearly, type PlanKey } from '@/lib/mfr';

export type PlanPrices = Record<string, { amount: number | null; note: string | null }>;
export async function loadPlanPrices(db: any): Promise<PlanPrices> {
  const r = await db.query('select key, amount_usd, note from plan_prices');
  return Object.fromEntries(r.rows.map((x: any) => [x.key, { amount: x.amount_usd, note: x.note }]));
}
const priceLine = (k: PlanKey, prices: PlanPrices, year = false) =>
  k === 'entry' || !prices[`mfr_${k}`]?.amount ? null
    : `$${(year ? yearly(prices[`mfr_${k}`].amount!) : prices[`mfr_${k}`].amount!).toLocaleString('en')}`;

// Every line of the three plans, and the lowest plan that has it.
const COMPARE: [string, PlanKey][] = [
  ['Complete market data', 'data'], ['Target distributor lists', 'data'], ['Portfolio analysis', 'data'], ['Market watch on your molecules', 'data'],
  ['Distributor portfolio matching, and the potential to supply them', 'access'], ['Pricing analysis', 'access'],
  ['Documentation and regulatory check', 'access'], ['Pathway to approval', 'access'],
  ['Distributor sourcing, done for you', 'entry'], ['Regulatory submissions and approvals, done for you', 'entry'],
  ['Sales forecasts and strategic review', 'entry'], ['Launch planned with the distributor’s sales team', 'entry'],
  ['One contact and weekly reports per market', 'entry'],
];
const rank = (k: PlanKey) => PLAN_ORDER.indexOf(k);

/** The three plans with the one that fits marked, a side-by-side comparison, and what happens after choosing. */
export default function PlanChooser({ p, prices, products, from, want, interval = 'month', market: pick }: {
  p: any; prices: PlanPrices; products: number; from: 'onboarding' | 'plan'; want?: PlanKey | null; interval?: 'month' | 'year'; market?: string;
}) {
  const year = interval === 'year';
  const targets: string[] = (p.target_countries ?? []).filter((c: string) => MFR_COUNTRIES.some((x) => x.code === c));
  const included = pick && targets.includes(pick) ? pick : p.primary_market && targets.includes(p.primary_market) ? p.primary_market : targets[0] ?? 'TZ';
  const extra = Number(prices.mfr_market?.amount ?? 49);
  const base = from === 'onboarding' ? '/m/onboarding?q=plan' : `/m/plan?${want ? `want=${want}&` : ''}`;
  const link = (o: { billing?: string; market?: string }) =>
    `${base}${base.endsWith('?') || base.endsWith('&') ? '' : '&'}billing=${o.billing ?? interval}&market=${o.market ?? included}`;
  // no markets recorded: a plan from before markets were priced, which covers every market chosen
  const paidMarkets: string[] = (p.paid_markets ?? []).length ? p.paid_markets : targets;
  const card = stripeReady();
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
            {active !== 'entry' ? ' Move up whenever you are ready.' : ' You have every part of Nazryx working for you.'}
            {' '}Billed {p.billing_interval === 'year' ? 'yearly' : 'monthly'}.</p>
          {active !== 'entry' && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="lbl">Markets in your plan</span>
              <div className="row" style={{ gap: 6 }}>
                {paidMarkets.map((c) => <span key={c} className="pill solid">{countryName(c)}</span>)}
                {targets.filter((c) => !paidMarkets.includes(c)).map((c) => (
                  <Link key={c} className="pill" href={`/m/add-market?market=${c}`}>+ Add {countryName(c)}</Link>))}
              </div>
              <span className="note">Each extra market ${p.billing_interval === 'year' ? `${yearly(extra).toLocaleString('en')} a year` : `${extra} a month`}.</span>
            </div>)}
        </section>
      ) : (
        <section className="card stack">
          <span className="lbl">Suggested for {p.company_name}</span>
          <h2 style={{ fontSize: 24 }}>{MFR_PLANS[s.plan].name}</h2>
          <p>Because {s.why.join(', ')}.</p>
          <p className="note">From your answers: {markets.length ? markets.join(', ') : 'no markets yet'} · {products} product{products === 1 ? '' : 's'} in your catalogue.</p>
        </section>)}

      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 6 }} aria-label="Billing">
          <Link className={`pill ${!year ? 'solid' : ''}`} href={link({ billing: 'month' })}>Monthly</Link>
          <Link className={`pill ${year ? 'solid' : ''}`} href={link({ billing: 'year' })}>Yearly · two months free</Link>
        </div>
        {targets.length > 1 && !p.active_plan && (
          <div className="row" style={{ gap: 6 }} aria-label="Market included"><span className="lbl">Market included</span>
            {targets.map((c) => <Link key={c} className={`pill ${c === included ? 'solid' : ''}`} href={link({ market: c })}>{countryName(c)}</Link>)}</div>)}
      </div>
      <div className="grid g3" data-tour="plans">
        {PLAN_ORDER.map((k) => {
          const pl = MFR_PLANS[k], pr = prices[`mfr_${k}`], on = k === highlight, isActive = k === active, asked = p.chosen_plan === k && !isActive;
          const amount = priceLine(k, prices, year), byCard = Boolean(amount) && card;
          const per = year ? 'a year' : 'a month';
          return (
            <form key={k} action={byCard ? startCheckout : choosePlan} className="card stack" style={on ? { borderColor: 'var(--blue)', borderWidth: 2 } : undefined}>
              <input type="hidden" name="plan" value={k} /><input type="hidden" name="from" value={from} />
              <input type="hidden" name="interval" value={interval} /><input type="hidden" name="market" value={included} />
              <div className="between" style={{ alignItems: 'flex-start' }}><h2>{pl.name}</h2>
                {isActive ? <span className="pill solid">Your plan</span> : asked ? <span className="pill blue">Requested</span>
                  : on ? <span className="pill blue">{want ? 'Unlocks it' : 'Suggested'}</span> : null}</div>
              <div>{amount ? <><b className="num" style={{ fontSize: 26 }}>{amount}</b><span className="muted"> / {year ? 'year' : 'month'}</span>
                  <div className="sub2">{countryName(included)} included · each extra market ${year ? yearly(extra).toLocaleString('en') : extra} {per}</div></>
                : <><b style={{ fontSize: 20 }}>Get in touch</b><div className="sub2">Every market you choose</div></>}{pr?.note && <div className="sub2">{pr.note}</div>}</div>
              <p className="muted">{pl.for}</p>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pl.includes.map((i) => <li key={i}>{i}</li>)}</ul>
              {isActive ? <span className="note" style={{ marginTop: 'auto' }}>Active now.</span>
                : active && rank(k) < rank(active) ? <span className="note" style={{ marginTop: 'auto' }}>Included in your plan.</span>
                : <button className={`btn ${on ? 'btn-blue' : 'btn-ghost'}`} type="submit" style={{ marginTop: 'auto' }}>
                    {!amount ? (asked ? 'We will be in touch' : 'Get in touch') : byCard ? (active ? `Upgrade, ${amount} ${per}` : `Subscribe, ${amount} ${per}`)
                      : asked ? 'Ask again' : `Choose ${pl.name}`}</button>}
            </form>);
        })}
      </div>

      <section className="card">
        <div className="card-h"><h2>Compare the plans</h2></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>What you get</th>{PLAN_ORDER.map((k) => <th key={k} className="r">{MFR_PLANS[k].name}</th>)}</tr></thead>
          <tbody>{COMPARE.map(([label, min]) => (
            <tr key={label}><td>{label}</td>{PLAN_ORDER.map((k) => (
              <td key={k} className="r">{rank(k) >= rank(min) ? <b style={{ color: 'var(--blue-txt)' }} aria-label="Included">✓</b> : <span className="muted" aria-label="Not included">—</span>}</td>))}</tr>))}
          </tbody></table></div>
      </section>

      <div className="grid g3">
        <section className="card stack"><span className="lbl">Basic and Access</span><h2>Subscribe by card</h2>
          <p className="muted">Monthly, or yearly with two months free. One market included, more at ${extra} a month each. Cancel any time
            from this page; everything opens as soon as the payment goes through.</p></section>
        <section className="card stack"><span className="lbl">Market Entry</span><h2>We talk first</h2>
          <p className="muted">Our team scopes your markets and products with you and sends a proposal within one working day.</p></section>
        <section className="card stack"><span className="lbl">Paperwork</span><h2>Done for you</h2>
          <p className="muted">Order confirmations and invoices land in Settings, Documents. Government fees are always yours, at cost.</p></section>
      </div>

      {p.stripe_customer && card && (
        <form action={openBillingPortal} className="row"><button className="btn btn-ghost btn-sm" type="submit">Manage card and billing</button>
          <span className="note">Change your card, see payments or cancel.</span></form>)}
      {from === 'onboarding' && (
        <form action={choosePlan} className="row"><input type="hidden" name="plan" value="" /><input type="hidden" name="from" value={from} />
          <button className="btn btn-ghost" type="submit">Explore the portal first</button>
          <span className="note">You can pick a plan any time under Plan.</span></form>)}
    </div>
  );
}
