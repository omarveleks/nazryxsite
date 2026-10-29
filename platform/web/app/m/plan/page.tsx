import Shell from '@/components/Shell';
import PlanChooser, { loadPlanPrices } from '@/components/PlanChooser';
import { Flash } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, withUser } from '@/lib/db';
import Link from 'next/link';
import { MFR_PLANS, countryName, tierOf, type PlanKey } from '@/lib/mfr';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'Your plan' };

export default async function MfrPlan({ searchParams }: { searchParams: Promise<{ requested?: string; error?: string; want?: string; paid?: string; billing?: string; market?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => ({
    p: await one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]),
    products: Number((await one(db, 'select count(*)::int as n from mfr_products where user_id = $1', [u.id]))?.n ?? 0),
    prices: await loadPlanPrices(db),
  }));
  return (
    <Shell user={u} title={t('Plans')} sub={t('Three plans, from market data to a market entry run for you')}
      actions={<Link className="btn btn-ghost btn-sm" href="/m/onboarding?step=3">{t('Change your answers')}</Link>}>
      <Flash sp={sp} />
      {sp.paid && <div className="ok" role="status">Payment received. Your plan switches on within a minute; your order confirmation and invoice follow in Settings, Documents.</div>}
      {sp.requested && <div className="ok" role="status">{t('Thanks. Our team will get in touch within one working day.')}</div>}
      {u.mfr_trial && u.mfr_trial_until && <div className="ok" role="status">Your trial of Basic Market Data on {countryName(u.mfr_markets[0])} runs until {fmtDate(u.mfr_trial_until)}.
        Pick a plan any time to keep it, add markets or open the tools.</div>}
      {d.p && !d.p.active_plan && d.p.trial_until && new Date(d.p.trial_until) < new Date() && <div className="note">Your trial has ended. Your data stays; a plan opens the market pages again.</div>}
      {d.p ? <PlanChooser p={d.p} prices={d.prices} products={d.products} from="plan" interval={sp.billing === 'year' ? 'year' : 'month'} market={sp.market}
        want={sp.want && sp.want in MFR_PLANS && (d.p.active_plan ? tierOf(d.p.active_plan) < tierOf(sp.want) : true) ? sp.want as PlanKey : null} /> : <p>{t('Tell us about your company first.')} <Link href="/m/onboarding">{t('Start')}</Link></p>}
    </Shell>
  );
}
