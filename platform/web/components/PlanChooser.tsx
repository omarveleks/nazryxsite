import { choosePlan, openBillingPortal, startCheckout } from '@/app/actions/mfr';
import { stripeReady } from '@/lib/stripe';
import Link from 'next/link';
import { tt } from '@/lib/i18n';
import { EXTRA_MARKET, MFR_COUNTRIES, MFR_PLANS, PLAN_MARKETS, PLAN_ORDER, countryName, suggestPlan, yearly, type PlanKey } from '@/lib/mfr';

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
  const t = tt();
  const year = interval === 'year';
  const targets: string[] = (p.target_countries ?? []).filter((c: string) => MFR_COUNTRIES.some((x) => x.code === c));
  const included = pick && targets.includes(pick) ? pick : p.primary_market && targets.includes(p.primary_market) ? p.primary_market : targets[0] ?? 'TZ';
  const extraFor = (k: string) => Number(prices[`mfr_market_${k}`]?.amount ?? EXTRA_MARKET[k] ?? 499);
  // the markets a plan includes: the one picked first, then the others they chose, up to the plan's number
  const includedFor = (k: string) => [included, ...targets.filter((c) => c !== included)].slice(0, PLAN_MARKETS[k] ?? 1);
  const money = (monthly: number, y: boolean) => `$${(y ? yearly(monthly) : monthly).toLocaleString('en')} ${y ? 'a year' : 'a month'}`;
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
          <span className="lbl">{t('To unlock that')}</span>
          <h2 style={{ fontSize: 24 }}>{MFR_PLANS[want].name}</h2>
          <p className="muted">{MFR_PLANS[want].for} It also includes everything below it.</p>
        </section>
      ) : active ? (
        <section className="card stack">
          <span className="lbl">{t('Your plan')}</span>
          <h2 style={{ fontSize: 24 }}>{MFR_PLANS[active].name}</h2>
          <p className="muted">Active{p.active_since ? ` since ${new Date(p.active_since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
            {active !== 'entry' ? ' Move up whenever you are ready.' : ' You have every part of Nazryx working for you.'}
            {' '}Billed {p.billing_interval === 'year' ? 'yearly' : 'monthly'}.</p>
          {active !== 'entry' && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="lbl">{t('Markets in your plan')}</span>
              <div className="row" style={{ gap: 6 }}>
                {paidMarkets.map((c) => <span key={c} className="pill solid">{countryName(c)}</span>)}
                {targets.filter((c) => !paidMarkets.includes(c)).map((c) => (
                  <Link key={c} className="pill" href={`/m/add-market?market=${c}`}>+ Add {countryName(c)}</Link>))}
              </div>
              <span className="note">{PLAN_MARKETS[active] && paidMarkets.length < PLAN_MARKETS[active]
                ? `Your plan includes ${PLAN_MARKETS[active]} markets: add ${PLAN_MARKETS[active] - paidMarkets.length} more at no extra cost. Beyond that, each extra market `
                : 'Each extra market '}{money(extraFor(active), p.billing_interval === 'year')}.</span>
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
        <div className="row" style={{ gap: 6 }} aria-label={t('Billing')}>
          <Link className={`pill ${!year ? 'solid' : ''}`} href={link({ billing: 'month' })}>{t('Monthly')}</Link>
          <Link className={`pill ${year ? 'solid' : ''}`} href={link({ billing: 'year' })}>{t('Yearly · two months free')}</Link>
        </div>
        {targets.length > 1 && !p.active_plan && (
          <div className="row" style={{ gap: 6 }} aria-label={t('Market included')}><span className="lbl">{targets.length > 1 ? 'First market' : 'Market included'}</span>
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
              {k !== 'entry' && <input type="hidden" name="markets" value={includedFor(k).join(',')} />}
              <div className="between" style={{ alignItems: 'flex-start' }}><h2>{pl.name}</h2>
                {isActive ? <span className="pill solid">{t('Your plan')}</span> : asked ? <span className="pill blue">{t('Requested')}</span>
                  : on ? <span className="pill blue">{want ? 'Unlocks it' : 'Suggested'}</span> : null}</div>
              <div>{amount ? <><b className="num" style={{ fontSize: 26 }}>{amount}</b><span className="muted"> / {year ? 'year' : 'month'}</span>
                  <div className="sub2">{(PLAN_MARKETS[k] ?? 1) === 1 ? `${countryName(included)} included`
                    : `${PLAN_MARKETS[k]} markets included${includedFor(k).length ? ` (${includedFor(k).map(countryName).join(', ')}${includedFor(k).length < PLAN_MARKETS[k] ? ', more any time' : ''})` : ''}`}
                    {' '}· each extra market {money(extraFor(k), year)}</div></>
                : <><b style={{ fontSize: 20 }}>{t('Get in touch')}</b><div className="sub2">{t('Every market you choose')}</div></>}{pr?.note && <div className="sub2">{pr.note}</div>}</div>
              <p className="muted">{pl.for}</p>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pl.includes.map((i) => <li key={i}>{i}</li>)}</ul>
              {isActive ? <span className="note" style={{ marginTop: 'auto' }}>{t('Active now.')}</span>
                : active && rank(k) < rank(active) ? <span className="note" style={{ marginTop: 'auto' }}>{t('Included in your plan.')}</span>
                : <button className={`btn ${on ? 'btn-blue' : 'btn-ghost'}`} type="submit" style={{ marginTop: 'auto' }}>
                    {!amount ? (asked ? 'We will be in touch' : 'Get in touch') : byCard ? (active ? `Upgrade, ${amount} ${per}` : `Subscribe, ${amount} ${per}`)
                      : asked ? 'Ask again' : `Choose ${pl.name}`}</button>}
            </form>);
        })}
      </div>

      <section className="card">
        <div className="card-h"><h2>{t('Compare the plans')}</h2></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>{t('What you get')}</th>{PLAN_ORDER.map((k) => <th key={k} className="r">{MFR_PLANS[k].name}</th>)}</tr></thead>
          <tbody>{COMPARE.map(([label, min]) => (
            <tr key={label}><td>{label}</td>{PLAN_ORDER.map((k) => (
              <td key={k} className="r">{rank(k) >= rank(min) ? <b style={{ color: 'var(--blue-txt)' }} aria-label={t('Included')}>✓</b> : <span className="muted" aria-label={t('Not included')}>—</span>}</td>))}</tr>))}
          </tbody></table></div>
      </section>

      <div className="grid g3">
        <section className="card stack"><span className="lbl">{t('Basic and Access')}</span><h2>{t('Subscribe by card')}</h2>
          <p className="muted">Monthly, or yearly with two months free. {MFR_PLANS.data.name}: one market included, more at ${extraFor('data')} a month
            each. {MFR_PLANS.access.name}: four markets included, more at ${extraFor('access')} a month each. Cancel any time from this page;
            everything opens as soon as the payment goes through.</p></section>
        <section className="card stack"><span className="lbl">{t('Market Entry')}</span><h2>{t('We talk first')}</h2>
          <p className="muted">{t('Our team scopes your markets and products with you and sends a proposal within one working day.')}</p></section>
        <section className="card stack"><span className="lbl">{t('Paperwork')}</span><h2>{t('Done for you')}</h2>
          <p className="muted">{t('Order confirmations and invoices land in Settings, Documents. Government fees are always yours, at cost.')}</p></section>
      </div>

      {p.stripe_customer && card && (
        <form action={openBillingPortal} className="row"><button className="btn btn-ghost btn-sm" type="submit">{t('Manage card and billing')}</button>
          <span className="note">{t('Change your card, see payments or cancel.')}</span></form>)}
      {from === 'onboarding' && (
        <form action={choosePlan} className="row"><input type="hidden" name="plan" value="" /><input type="hidden" name="from" value={from} />
          <button className="btn btn-ghost" type="submit">{t('Explore the portal first')}</button>
          <span className="note">{t('You can pick a plan any time under Plan.')}</span></form>)}
    </div>
  );
}
