import { choosePlan } from '@/app/actions/mfr';
import { ADD_ONS, MFR_PLANS, countryName, suggestPlan, type PlanKey } from '@/lib/mfr';

export type PlanPrices = Record<string, { price: string | null; note: string | null }>;
export async function loadPlanPrices(db: any): Promise<PlanPrices> {
  const r = await db.query('select key, price, note from plan_prices');
  return Object.fromEntries(r.rows.map((x: any) => [x.key, { price: x.price, note: x.note }]));
}
const ON_SCOPE = 'Priced on your scope';

/** The suggested subscription from the manufacturer's answers, the other plans beside it, and add-ons. */
export default function PlanChooser({ p, prices, products, from }: { p: any; prices: PlanPrices; products: number; from: 'onboarding' | 'plan' }) {
  const s = suggestPlan(p);
  const order: PlanKey[] = ['insight', 'entry', 'regional'];
  const markets = (p.target_countries ?? []).map(countryName);
  return (
    <div className="stack">
      <section className="card stack">
        <span className="lbl">Suggested for {p.company_name}</span>
        <h2 style={{ fontSize: 26 }}>{MFR_PLANS[s.plan].name}</h2>
        <p>Because {s.why.join(', ')}.</p>
        <p className="note">Based on {markets.length ? markets.join(', ') : 'no markets yet'} · {products} product{products === 1 ? '' : 's'} in your catalogue
          {p.timeline ? ` · ${p.timeline === 'exploring' ? 'exploring' : p.timeline === 'now' ? 'filing this quarter' : `within ${p.timeline.replace('m', ' months')}`}` : ''}.</p>
      </section>
      <div className="grid g3">
        {order.map((k) => {
          const pl = MFR_PLANS[k], pr = prices[`mfr_${k}`], best = k === s.plan, chosen = p.chosen_plan === k;
          return (
            <form key={k} action={choosePlan} className="card stack" style={best ? { borderColor: 'var(--blue)', borderWidth: 2 } : undefined}>
              <input type="hidden" name="plan" value={k} /><input type="hidden" name="from" value={from} />
              <div className="between"><span className="lbl">{pl.kind}</span>
                {chosen ? <span className="pill solid">Requested</span> : best && <span className="pill blue">Suggested</span>}</div>
              <h2>{pl.name}</h2>
              <div><b className="num" style={{ fontSize: 20 }}>{pr?.price || ON_SCOPE}</b>{pr?.note && <div className="sub2">{pr.note}</div>}</div>
              <p className="note">{pl.for}</p>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pl.includes.map((i) => <li key={i}>{i}</li>)}</ul>
              {best && s.addOns.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="lbl">Recommended add-ons</span>
                  {s.addOns.map((a) => (
                    <label key={a} className="choice"><input type="checkbox" name="add_ons" value={a} defaultChecked />
                      <span><b>{ADD_ONS[a].name}</b>{prices[`addon_${a}`]?.price ? ` · ${prices[`addon_${a}`].price}` : ''}<br /><span className="note">{ADD_ONS[a].what}</span></span></label>))}
                </div>)}
              <button className={`btn ${best ? 'btn-blue' : 'btn-ghost'}`} type="submit" style={{ marginTop: 'auto' }}>
                {chosen ? 'Request again' : `Start with ${pl.name}`}</button>
            </form>);
        })}
      </div>
      <p className="note">Nothing is charged here. Our team confirms the scope and price with you, usually within one working day, and invoices you.
        {from === 'onboarding' ? ' You can also explore the portal first and pick a plan later under Plan.' : ''}</p>
      {from === 'onboarding' && (
        <form action={choosePlan}><input type="hidden" name="plan" value="" /><input type="hidden" name="from" value={from} />
          <button className="btn btn-ghost" type="submit">Explore the portal first</button></form>)}
    </div>
  );
}
