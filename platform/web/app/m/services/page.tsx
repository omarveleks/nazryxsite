import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, LockIcon, StagePill } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { AGENCY_KINDS, MFR_PLANS, NEEDS_PLAN, SERVICES, canUse, countryName, recommendServices } from '@/lib/mfr';

export const metadata = { title: 'Services' };

// A menu of services. Each opens its own page with what it involves and the form; the ones that fit come first.
export default async function Services({ searchParams }: { searchParams: Promise<{ product?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => ({
    p: await one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]),
    engagements: await rows(db, `select e.id, e.kind, e.country, e.stage, e.status, e.due_at, e.created_at, coalesce(m.inn, p.name) as product
                                 from engagements e left join mfr_products p on p.id = e.product_id left join molecules m on m.id = p.molecule_id
                                 where e.user_id = $1 order by (e.status = 'open') desc, e.updated_at desc limit 12`, [u.id]),
  }));
  const open = new Set(d.engagements.filter((e) => e.status === 'open').map((e) => e.kind));
  const recs = recommendServices(d.p).filter((r) => r.kind === 'report' || !open.has(r.kind)).slice(0, 3);
  const all = [...AGENCY_KINDS, 'partner_intro', 'report'];
  const q = sp.product ? `?product=${sp.product}` : '';
  const Card = ({ k, why }: { k: string; why?: string }) => {
    const ok = canUse(u.mfr_tier, k);
    return (
      <Link href={ok ? `/m/services/${k}${q}` : `/m/plan?want=${NEEDS_PLAN[k]}`} className="card stack" style={{ gap: 8, textDecoration: 'none', color: 'inherit' }}>
        <h2>{SERVICES[k].label}</h2>
        {!ok ? <span className="pill lav" style={{ alignSelf: 'flex-start' }}><LockIcon /> In {MFR_PLANS[NEEDS_PLAN[k]].name}</span>
          : open.has(k) ? <span className="pill blue" style={{ alignSelf: 'flex-start' }}>In progress</span> : null}
        <p className="muted">{SERVICES[k].what}</p>
        {why && <p className="note">Because {why}.</p>}
        <span className="btn-link small" style={{ marginTop: 'auto' }}>{ok ? 'Open →' : 'See what unlocks it →'}</span>
      </Link>);
  };
  return (
    <Shell user={u} title="Services" sub="Our team on the ground, for the work you would rather not do yourself">
      <Flash sp={sp} />
      {d.engagements.length > 0 && (
        <section className="card">
          <div className="card-h"><h2>In progress</h2></div>
          <div className="stack" style={{ gap: 10 }}>{d.engagements.map((e) => (
            <Link key={e.id} href={`/m/engagements/${e.id}`} className="between">
              <span><b>{SERVICES[e.kind].label}</b>{e.product ? ` · ${e.product}` : ''}{e.country ? ` · ${countryName(e.country)}` : ''}
                <span className="sub2"> · {e.kind === 'report' && e.stage !== 'Delivered' && e.due_at ? `due ${fmtDate(e.due_at)}` : `since ${fmtDate(e.created_at)}`}</span></span>
              <StagePill stage={e.status === 'open' ? e.stage : e.status === 'done' ? 'Closed' : 'Cancelled'} /></Link>))}</div>
        </section>)}
      {recs.length > 0 && (<>
        <h2>Picked for you</h2>
        <div className="grid g3">{recs.map((r) => <Card key={r.kind} k={r.kind} why={r.why} />)}</div>
      </>)}
      <h2>All services</h2>
      <div className="grid g3">{all.filter((k) => !recs.some((r) => r.kind === k)).map((k) => <Card key={k} k={k} />)}</div>
      {d.engagements.length === 0 && <Empty>Pick a service to see what it involves. Asking starts a conversation with our team, not a charge.</Empty>}
    </Shell>
  );
}
