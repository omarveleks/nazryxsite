import Link from 'next/link';
import Shell from '@/components/Shell';
import { ManagedBadge, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { DemandIcon, VerifiedIcon } from '@/components/Icons';
import { Badges, Empty, Flash, PlanLock, StagePill } from '@/components/ui';
import { chooseSample, tourGo } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { HIGH_DEMAND, MFR_PLANS, OBLIGATION_KINDS, SERVICES, canUse, covers, tierIn, countryName, mfrProductsSql, reasons } from '@/lib/mfr';

export const metadata = { title: 'Home' };

const WATCH: Record<string, string> = { added: 'New competitor', removed: 'Competitor left', status: 'Registration lapsed', reactivated: 'Back on the market' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Manufacturer Home: what to register first and what moved in your markets on the left; your plan, markets and
// work in progress on the right.
export default async function MfrHome({ searchParams }: { searchParams: Promise<{ welcome?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const watchAll = canUse(u.mfr_tier, 'watch');
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const profile = await one(db, `select company_name, status, target_countries, suggested_plan, chosen_plan, active_plan, verified_at, sample_product_id, primary_market,
                                   cardinality(certifications) + cardinality(dosage_forms) as profile_bits
                                   from manufacturer_profiles where user_id = $1`, [u.id]);
    const targets = targetMarkets(profile?.target_countries);
    const live = targets.filter(hasData);
    const chosen = pickMarket(undefined, targets, profile?.primary_market);
    // Home reads a market in the plan: the chosen one if it is, else the first that is
    const inPlan = live.filter((c) => covers(u, c));
    const focus = hasData(chosen) && (!u.mfr_active || covers(u, chosen)) ? chosen : inPlan[0] ?? (hasData(chosen) ? chosen : live[0] ?? 'TZ');
    const full = canUse(tierIn(u, focus), 'portfolio');
    const counts = await one(db, `select count(*)::int as products, count(p.molecule_id)::int as matched,
        count(*) filter (where g.demand >= ${HIGH_DEMAND})::int as high,
        count(*) filter (where cm.registrants <= 3 and (cm.registrations > 0 or cm.on_national_list))::int as few,
        (select count(*)::int from launches l where l.user_id = $1) as launches,
        (select count(*)::int from mfr_files f where f.user_id = $1 and f.kind = 'gmp') as gmp
        from mfr_products p left join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = $2
        left join visible_gap_scores g on g.molecule_id = p.molecule_id and g.country = $2 where p.user_id = $1`, [u.id, focus]);
    const first = await rows(db, `${mfrProductsSql(focus)} where p.user_id = $1 and cm.rankable and cm.on_national_list
        order by g.score desc nulls last, cm.registrants, p.name limit $2`, [u.id, full ? 5 : 3]);
    const watchMarkets = u.mfr_active ? inPlan : live;
    const watch = watchMarkets.length ? await rows(db, 'select * from my_market_watch($1, 90)', [watchMarkets]) : [];
    const engagements = await rows(db, `select id, kind, country, stage from engagements where user_id = $1 and status = 'open' order by updated_at desc limit 5`, [u.id]);
    const deadlines = await rows(db, `select o.kind, o.due_date, o.country, p.name from obligations o left join mfr_products p on p.id = o.product_id
        where o.user_id = $1 and not o.done order by o.due_date limit 5`, [u.id]);
    const products = profile?.sample_product_id ? [] : await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p
        left join molecules m on m.id = p.molecule_id where p.user_id = $1 and p.molecule_id is not null order by 2 limit 200`, [u.id]);
    return { profile, targets, focus, full, counts, first, watch, engagements, deadlines, products };
  });
  const p = d.profile;
  const full = d.full;
  const shownWatch = watchAll ? d.watch.slice(0, 8) : d.watch.slice(0, 2);
  // getting set up: the few things that make the portal useful, ticked off as they are done
  const setup: [boolean, string, string][] = [
    [Number(d.counts?.products) > 0, 'Add your products', '/m/products#add'],
    [Number(p?.profile_bits) > 0, 'Add your certifications and dosage forms', '/m/onboarding?step=2'],
    [Boolean(p?.sample_product_id) || u.mfr_tier >= 2, 'Open one product in full, free', '#free-read'],
    [Number(d.counts?.launches) > 0, 'Put a product on your launch tracker', '/m/products'],
    [Boolean(p?.chosen_plan || p?.active_plan), 'Pick your plan', '/m/plan'],
    [Boolean(p?.verified_at) || Number(d.counts?.gmp) > 0, 'Upload your GMP certificate for the Verified badge', '/m/products#files'],
  ];
  const doneN = setup.filter(([ok]) => ok).length;
  return (
    <Shell user={u} title={<>{p?.company_name ? p.company_name : 'Welcome'}{p?.verified_at && <span className="pill blue" style={{ marginLeft: 12, verticalAlign: 'middle', fontSize: 13, letterSpacing: 'normal', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}><VerifiedIcon /> Verified manufacturer</span>}</>}
      sub={`Your products in ${d.targets.map(countryName).join(', ')}`}
      actions={<><Link className="btn btn-ghost btn-sm" href="/m/products#add">Add a product</Link><Link className="btn btn-blue btn-sm" href="/m/services">Get help</Link></>}>
      <Flash sp={sp} />
      {p?.status === 'pending' && <div className="note">Our team is reviewing your company. Everything is open to explore; introductions start once you are approved.</div>}
      {sp.welcome && <div className="ok">{d.counts?.products ? `Welcome. Your ${d.counts.products} products are matched to your markets below.` : 'Welcome. Add your products and we match them to your markets in seconds.'}</div>}

      {doneN < setup.length && (
        <section className="card stack" style={{ gap: 10 }}>
          <div className="between"><h2>Get set up · {doneN} of {setup.length}</h2>
            <form action={tourGo}><input type="hidden" name="step" value="1" /><button className="btn btn-ghost btn-sm" type="submit">Take the tour</button></form></div>
          <div className="meter"><i style={{ width: `${(100 * doneN) / setup.length}%` }} /></div>
          <div className="grid g3" style={{ gap: 8 }}>{setup.map(([ok, label, href]) => ok
            ? <span key={label} className="small muted">✓ {label}</span>
            : <Link key={label} href={href} className="small">{label} →</Link>)}</div>
        </section>)}
      <div className="grid g4">
        <Link className="tile t-white" href="/m/products"><span className="k">Your products</span><span className="v num">{d.counts?.products}</span>
          <span className="small">{d.counts?.matched} matched</span></Link>
        <Link className="tile t-peach" href="/m/products"><span className="k"><DemandIcon /> In high demand</span><span className="v num">{d.counts?.high}</span>
          <span className="small">in {countryName(d.focus)}</span></Link>
        <Link className="tile t-mint" href="/m/products"><span className="k">Little or no competition</span><span className="v num">{d.counts?.few}</span>
          <span className="small">3 competitors or fewer</span></Link>
        <Link className="tile t-blue" href="/m/products?tab=launches"><span className="k">On your launch tracker</span><span className="v num">{d.counts?.launches}</span>
          <span className="small">products and markets</span></Link>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card" data-tour="home">
            <div className="card-h"><div><h2>Register these first</h2><p className="note">The clearest openings for your products in {countryName(d.focus)}.</p></div>
              <Link className="btn-link" href="/m/products">All products</Link></div>
            {d.counts?.products === 0 ? (
              <div className="between" style={{ flexWrap: 'wrap' }}><span className="muted">Add your products and we rank them against the market.</span>
                <Link className="btn btn-blue btn-sm" href="/m/products#add">Add products</Link></div>
            ) : d.first.length === 0 ? <Empty>None of your matched products is on the official essential list yet.</Empty> : (
              <div>{d.first.map((x, i) => (
                <Link key={x.id} href={`/m/products/${x.id}?market=${d.focus}`} className="between"
                  style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 0', borderTop: i ? '1px solid var(--line)' : undefined, textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                    <span className="nm">{x.inn ?? x.name}</span>
                    <div className="sub2">{cap(reasons(x).join(' · '))}</div>
                    <div style={{ marginTop: 6 }}><Badges m={x} /></div>
                  </div>
                  <span className="small">Open →</span>
                </Link>))}</div>)}
            {!full && d.first.length > 0 && <div style={{ marginTop: 12 }}><PlanLock compact need="data" title="See your full ranking" /></div>}
          </section>

          <section className="card">
            <div className="card-h"><div><h2>Market watch</h2><p className="note">What moved in your molecules in the last 90 days.</p></div></div>
            {d.watch.length === 0 ? <Empty>Quiet: no changes in your molecules in the last 90 days.</Empty> : (
              <div>{shownWatch.map((w, i) => (
                <div key={i} className="between small" style={{ padding: '10px 0', borderTop: i ? '1px solid var(--line)' : undefined, gap: 12 }}>
                  <span><b>{WATCH[w.change] ?? cap(w.change)}</b> · {w.molecule} · {countryName(w.country)}{w.made_in ? <span className="muted"> · made in {w.made_in}</span> : null}</span>
                  <span className="muted num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(w.at)}</span>
                </div>))}</div>)}
            {!watchAll && d.watch.length > shownWatch.length && (
              <div style={{ marginTop: 12 }}><PlanLock need="data" title={`${d.watch.length - shownWatch.length} more changes in your molecules`}>
                Every new competitor, exit and lapsed registration in your molecules, in all your markets.</PlanLock></div>)}
          </section>
        </div>

        <div className="stack">
          <section className="card stack">
            <div className="between"><h2>Your plan</h2><Link className="btn-link" href="/m/plan">Plans</Link></div>
            {p?.active_plan ? <p><b>{MFR_PLANS[p.active_plan as keyof typeof MFR_PLANS]?.name}</b> <span className="pill solid">Active</span></p>
              : p?.chosen_plan ? <p><b>{MFR_PLANS[p.chosen_plan as keyof typeof MFR_PLANS]?.name}</b> <span className="pill blue">Requested</span></p>
              : <><p>Suggested for you: <b>{MFR_PLANS[(p?.suggested_plan ?? 'data') as keyof typeof MFR_PLANS]?.name}</b></p>
                <Link className="btn btn-blue btn-sm" href="/m/plan" style={{ alignSelf: 'flex-start' }}>See plans</Link></>}
          </section>

          {!u.whatsapp && (
            <section className="card stack" style={{ gap: 8 }}>
              <h2>Updates on WhatsApp</h2>
              <p className="small muted">A short weekly summary, new competitors in the molecules you watch, and news on your projects.</p>
              <Link className="btn btn-ghost btn-sm" href="/settings" style={{ alignSelf: 'flex-start' }}>Add your WhatsApp number</Link>
            </section>)}
          {!p?.verified_at && Number(d.counts?.gmp) > 0 && (
            <section className="card stack" style={{ gap: 6 }}>
              <span className="pill lav" style={{ alignSelf: 'flex-start' }}><VerifiedIcon /> Verified badge</span>
              <p className="small muted">We are checking your GMP certificate. Once checked, the Verified manufacturer badge shows on your account and your market reads.</p>
            </section>)}
          {!p?.sample_product_id && u.mfr_tier < 2 && d.products.length > 0 && (
            <section className="card stack" id="free-read">
              <h2>One product, fully open</h2>
              <p className="muted">Pick one product and see everything we have on it, free: competition, distributors, route and price.</p>
              <form action={chooseSample} className="row">
                <select className="input" name="product_id" aria-label="Product" style={{ flex: '1 1 160px' }}>
                  {d.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button className="btn btn-blue btn-sm" type="submit">Open it</button>
              </form>
              <span className="note">One product, once.</span>
            </section>)}

          <section className="card stack">
            <div className="between"><h2>Your markets</h2><Link className="btn-link" href="/m/onboarding?step=3">Edit</Link></div>
            {d.targets.map((c) => (
              <div key={c} className="between"><span>{countryName(c)}</span>
                {hasData(c) ? <Link className="small" href={`/m/market?market=${c}`}>Open →</Link> : <ManagedBadge />}</div>))}
            {canUse(u.mfr_tier, 'market_read') && <Link className="btn btn-ghost btn-sm" href={`/m/report?market=${d.focus}`} style={{ alignSelf: 'flex-start' }}>Download a market read</Link>}
          </section>

          {(d.engagements.length > 0 || d.deadlines.length > 0) && (
            <section className="card stack">
              <h2>In progress</h2>
              {d.engagements.map((e) => (
                <Link key={e.id} href={`/m/engagements/${e.id}`} className="between small"><span>{SERVICES[e.kind].label}{e.country ? ` · ${countryName(e.country)}` : ''}</span>
                  <StagePill stage={e.stage} /></Link>))}
              {d.deadlines.map((o, i) => (
                <div key={i} className="between small"><span>{OBLIGATION_KINDS[o.kind]}{o.name ? ` · ${o.name}` : ''} · {countryName(o.country)}</span>
                  <span className="num">{fmtDate(o.due_date)}</span></div>))}
            </section>)}
          <p className="note">A question? <Link href="/expert">Ask our team</Link>.</p>
        </div>
      </div>
    </Shell>
  );
}
