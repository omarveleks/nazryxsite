import Link from 'next/link';
import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { addMarket } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { MFR_COUNTRIES, MFR_PLANS, countryName, covers, yearly } from '@/lib/mfr';
import { stripeReady } from '@/lib/stripe';

export const metadata = { title: 'Add a market' };

// One market more in the plan: the price at the plan's billing interval, what it opens, and one button.
export default async function AddMarket({ searchParams }: { searchParams: Promise<{ market?: string; saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const market = MFR_COUNTRIES.some((c) => c.code === sp.market) ? sp.market! : null;
  if (!market) redirect('/m/market');
  if (!u.mfr_active) redirect(`/m/plan?want=data&market=${market}`);
  if (covers(u, market)) redirect(`/m/market?market=${market}`);
  const d = await withUser(u.id, async (db) => ({
    price: await one(db, "select amount_usd from plan_prices where key = 'mfr_market'"),
    p: await one(db, 'select stripe_subscription, billing_interval from manufacturer_profiles where user_id = $1', [u.id]),
    asked: await one(db, `select 1 as x from plan_requests where user_id = $1 and wanted = $2 and status = 'open'`, [u.id, `market:${market}`]),
  }));
  const monthly = Number(d.price?.amount_usd ?? 49);
  const year = d.p?.billing_interval === 'year';
  const byCard = stripeReady() && Boolean(d.p?.stripe_subscription);
  const plan = MFR_PLANS[u.mfr_active as keyof typeof MFR_PLANS];
  const name = countryName(market);
  return (
    <Shell user={u} title={`Add ${name}`} sub="One more market in your plan" crumb={<><Link href="/m/plan">Your plan</Link> / Add a market</>}>
      <Flash sp={sp} />
      {sp.saved === 'market' || d.asked ? (
        <section className="card stack"><h2>Asked</h2>
          <p className="muted">Our team adds {name} to your plan and sends the invoice, usually within one working day.</p>
          <Link className="btn btn-ghost btn-sm" href="/m" style={{ alignSelf: 'flex-start' }}>Back to Home</Link></section>
      ) : (
        <section className="card stack" style={{ maxWidth: 560 }}>
          <span className="lbl">{plan?.name}</span>
          <h2 style={{ fontSize: 26 }}>{name}</h2>
          <p><b className="num">${year ? yearly(monthly).toLocaleString('en') : monthly}</b> {year ? 'a year (two months free)' : 'a month'}, on top of your plan.
            Cancel the market any time; your plan stays.</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Everything your plan opens, for {name}: the market, your products against it, distributors, competitor watch</li>
            <li>{name}&rsquo;s regulatory requirements, overall and for each of your products</li>
            <li>The market read for {name}, to download</li>
          </ul>
          <form action={addMarket}>
            <input type="hidden" name="market" value={market} /><input type="hidden" name="return" value={`/m/market?market=${market}`} />
            <button className="btn btn-blue" type="submit">{byCard ? `Add ${name}: pay by card` : `Ask to add ${name}`}</button>
          </form>
          <p className="note">{byCard ? 'You confirm the payment on the card page, with the card you already use.' : 'Your plan is invoiced, so our team adds it and invoices you.'}</p>
        </section>)}
    </Shell>
  );
}
