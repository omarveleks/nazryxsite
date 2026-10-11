import Link from 'next/link';
import Shell from '@/components/Shell';
import { Badges, Empty, Flash, StagePill } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { MFR_COUNTRIES, MFR_PLANS, MFR_PRODUCTS_SQL, OBLIGATION_KINDS, SERVICES, countryName, reasons } from '@/lib/mfr';

export const metadata = { title: 'Home' };

// Manufacturer Home: two thirds what to do (register these first, engagements), one third the markets and deadlines.
export default async function MfrHome({ searchParams }: { searchParams: Promise<{ welcome?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const paid = u.plan === 'paid' || u.role === 'team';
  const d = await withUser(u.id, async (db) => {
    const profile = await one(db, 'select company_name, status, target_countries, suggested_plan, chosen_plan from manufacturer_profiles where user_id = $1', [u.id]);
    const counts = await one(db, `select count(*)::int as products, count(p.molecule_id)::int as matched,
        count(*) filter (where cm.registrants = 0 and cm.on_national_list)::int as open,
        count(*) filter (where cm.registrants between 1 and 3)::int as few
        from mfr_products p left join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = 'TZ' where p.user_id = $1`, [u.id]);
    const first = await rows(db, `${MFR_PRODUCTS_SQL} where p.user_id = $1 and cm.rankable and cm.on_national_list
        order by g.score desc nulls last, cm.registrants, p.name limit $2`, [u.id, paid ? 6 : 3]);
    const engagements = await rows(db, `select id, kind, country, stage, status, due_at, updated_at from engagements
        where user_id = $1 and status = 'open' order by updated_at desc limit 6`, [u.id]);
    const deadlines = await rows(db, `select o.kind, o.due_date, o.country, p.name from obligations o left join mfr_products p on p.id = o.product_id
        where o.user_id = $1 and not o.done order by o.due_date limit 5`, [u.id]);
    return { profile, counts, first, engagements, deadlines };
  });
  const targets: string[] = d.profile?.target_countries?.length ? d.profile.target_countries : ['TZ'];
  return (
    <Shell user={u} title={`Welcome${d.profile?.company_name ? `, ${d.profile.company_name}` : ''}`} sub="Take your products into new markets"
      actions={<Link className="btn btn-blue btn-sm" href="/m/services">Start market entry</Link>}>
      <Flash sp={sp} />
      {d.profile?.status === 'pending' && <div className="note">Our team is reviewing your company. You can add products and explore now; partner introductions open once you are approved.</div>}
      {sp.welcome && <div className="ok">{d.counts?.products ? `Welcome. Your ${d.counts.products} products are matched to the market below.`
        : 'Welcome. Start by adding your products: we match them to the market in seconds.'}</div>}

      <div className="grid g4">
        <Link className="tile t-white" href="/m/products"><span className="k">Your products</span><span className="v num">{d.counts?.products}</span></Link>
        <Link className="tile t-blue" href="/m/products"><span className="k">Matched to the Tanzania market</span><span className="v num">{d.counts?.matched}</span></Link>
        <Link className="tile t-peach" href="/m/products"><span className="k">On the TMDA list, nobody registered</span><span className="v num">{d.counts?.open}</span></Link>
        <Link className="tile t-mint" href="/m/products"><span className="k">3 or fewer competitors</span><span className="v num">{d.counts?.few}</span></Link>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card-h"><div><h2>Register these first</h2><p className="note">Your products with the clearest opening in Tanzania, and why.</p></div>
              <Link className="btn-link" href="/m/products">All products</Link></div>
            {d.counts?.products === 0 ? (
              <div className="between" style={{ flexWrap: 'wrap' }}><span className="muted">Add your product list and we rank it against the market.</span>
                <Link className="btn btn-blue btn-sm" href="/m/products">Add products</Link></div>
            ) : d.first.length === 0 ? <Empty>None of your matched products is on the official TMDA list yet. See all products for the full picture.</Empty> : (
              <div>{d.first.map((p, i) => (
                <div key={p.id} className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '14px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                  <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                    <Link href={`/m/products/${p.id}`}><span className="nm">{p.inn ?? p.name}</span></Link>
                    <div className="sub2">{reasons(p).join(' · ')}</div>
                    <div style={{ marginTop: 6 }}><Badges m={p} /></div>
                  </div>
                  <Link className="btn btn-blue btn-sm" href={`/m/products/${p.id}`}>Open</Link>
                </div>))}</div>)}
            {!paid && d.first.length > 0 && <p className="note" style={{ marginTop: 12 }}>Free plan: top 3. <Link href="/settings#plan">Upgrade</Link> for the full ranking, suggested prices and timelines.</p>}
          </section>

          <section className="card">
            <div className="card-h"><h2>Your engagements</h2><Link className="btn-link" href="/m/services">Services</Link></div>
            {d.engagements.length === 0 ? <Empty>No engagements yet. Order a 24-hour report, or ask us to take a product into a market.</Empty> : (
              <div className="stack" style={{ gap: 10 }}>{d.engagements.map((e) => (
                <Link key={e.id} href={`/m/engagements/${e.id}`} className="between">
                  <span>{SERVICES[e.kind].label}{e.country ? ` · ${countryName(e.country)}` : ''}
                    {e.kind === 'report' && e.due_at && e.stage !== 'Delivered' ? <span className="sub2"> · due {fmtDate(e.due_at)}</span> : null}</span>
                  <StagePill stage={e.stage} /></Link>))}</div>)}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Your plan</h2><Link className="btn-link" href="/m/plan">{d.profile?.chosen_plan ? 'Change' : 'See plans'}</Link></div>
            {d.profile?.chosen_plan ? (
              <p><b>{MFR_PLANS[d.profile.chosen_plan as keyof typeof MFR_PLANS]?.name}</b> <span className="pill blue">Requested</span><br />
                <span className="note">Our team confirms scope and price with you, usually within one working day.</span></p>
            ) : (<>
              <p>Suggested for you: <b>{MFR_PLANS[(d.profile?.suggested_plan ?? 'insight') as keyof typeof MFR_PLANS]?.name}</b></p>
              <Link className="btn btn-blue btn-sm" href="/m/plan" style={{ marginTop: 10 }}>See why</Link>
            </>)}
          </section>
          <section className="card">
            <div className="card-h"><h2>Your markets</h2><Link className="btn-link" href="/m/onboarding?step=3">Edit</Link></div>
            <div className="stack" style={{ gap: 8 }}>{MFR_COUNTRIES.filter((c) => targets.includes(c.code)).map((c) => (
              <div key={c.code} className="between"><span>{c.name}</span>
                <span className={`pill ${c.data ? 'mint' : ''}`}>{c.data ? 'Market data live' : 'Agency coverage'}</span></div>))}</div>
            <p className="note" style={{ marginTop: 10 }}>Agency coverage: our team works the market for you. Data screens follow as we load each country.</p>
          </section>
          <section className="card">
            <div className="card-h"><h2>Upcoming deadlines</h2></div>
            {d.deadlines.length === 0 ? <Empty>Renewals, variations and safety reports appear here once we manage your registrations.</Empty> : (
              <div className="stack" style={{ gap: 8 }}>{d.deadlines.map((o, i) => (
                <div key={i} className="between"><span>{OBLIGATION_KINDS[o.kind]}{o.name ? ` · ${o.name}` : ''}<span className="sub2"> · {countryName(o.country)}</span></span>
                  <span className="small num">{fmtDate(o.due_date)}</span></div>))}</div>)}
          </section>
          <section className="card">
            <div className="card-h"><h2>Need a fast answer?</h2></div>
            <p className="muted">A written report from our team within 24 hours, or a quick question to our experts.</p>
            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn btn-blue btn-sm" href="/m/services#report">Order a report</Link>
              <Link className="btn btn-ghost btn-sm" href="/expert">Ask the expert</Link>
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
