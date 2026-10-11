import Shell from '@/components/Shell';
import PlanChooser, { loadPlanPrices } from '@/components/PlanChooser';
import { Flash } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import Link from 'next/link';

export const metadata = { title: 'Your plan' };

export default async function MfrPlan({ searchParams }: { searchParams: Promise<{ requested?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => ({
    p: await one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]),
    products: Number((await one(db, 'select count(*)::int as n from mfr_products where user_id = $1', [u.id]))?.n ?? 0),
    prices: await loadPlanPrices(db),
  }));
  return (
    <Shell user={u} title="Your plan" sub="Suggested from your company, markets, catalogue and needs"
      actions={<Link className="btn btn-ghost btn-sm" href="/m/onboarding?step=3">Change your answers</Link>}>
      <Flash sp={sp} />
      {sp.requested && <div className="ok" role="status">Thanks. Our team will confirm the scope and price with you, usually within one working day.</div>}
      {d.p ? <PlanChooser p={d.p} prices={d.prices} products={d.products} from="plan" /> : <p>Tell us about your company first. <Link href="/m/onboarding">Start</Link></p>}
    </Shell>
  );
}
