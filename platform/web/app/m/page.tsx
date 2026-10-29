import Link from 'next/link';
import Shell from '@/components/Shell';
import LocalTime from '@/components/LocalTime';
import { ManagedBadge, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { DemandIcon, VerifiedIcon } from '@/components/Icons';
import { Badges, Empty, Flash, PlanLock, StagePill } from '@/components/ui';
import { chooseSample, tourGo } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { HIGH_DEMAND, MFR_PLANS, OBLIGATION_KINDS, SERVICES, canUse, covers, tierIn, countryName, mfrProductsSql, reasons, byMolecule } from '@/lib/mfr';

export const metadata = { title: 'Home' };

const WATCH: Record<string, string> = { added: 'New competitor', removed: 'Competitor left', status: 'Registration lapsed', reactivated: 'Back on the market' };
const WATCH_MANY: Record<string, string> = { added: '{n} new competitors', removed: '{n} competitors left', status: '{n} registrations lapsed', reactivated: '{n} back on the market' };
/** The same change on the same molecule, market and day reads as one line with a count, not eight. */
function groupWatch(rows: any[]) {
  const out = new Map<string, any>();
  for (const w of rows) {
    const k = `${w.change}|${w.molecule}|${w.country}|${String(w.at).slice(0, 10)}`;
    const g = out.get(k);
    if (g) { g.n += 1; if (w.made_in && !g.made.includes(w.made_in)) g.made.push(w.made_in); }
    else out.set(k, { ...w, n: 1, made: w.made_in ? [w.made_in] : [] });
  }
  return [...out.values()];
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Manufacturer Home: what to register first and what moved in your markets on the left; your plan, markets and
// work in progress on the right.
export default async function MfrHome({ searchParams }: { searchParams: Promise<{ welcome?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const watchAll = canUse(u.mfr_tier, 'watch');
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const profile = await one(db, `select company_name, status, target_countries, suggested_plan, chosen_plan, active_plan, verified_at, sample_product_id, primary_market,
                                   cardinality(certifications) + cardinality(dosage_forms) as profile_bits
                                   from manufacturer_profiles where user_id = $1`, [u.id]);
    const targets = targetMarkets(profile?.target_countries, u.mfr_markets);
    const live = targets.filter(hasData);
    const chosen = pickMarket(undefined, targets, profile?.primary_market);
    // Home reads a market in the plan: the chosen one if it is, else the first that is
    const inPlan = live.filter((c) => covers(u, c));
    const focus = hasData(chosen) && (!u.mfr_active || covers(u, chosen)) ? chosen : inPlan[0] ?? (hasData(chosen) ? chosen : live[0] ?? 'TZ');
    const full = canUse(tierIn(u, focus), 'portfolio');
    const watchMarkets = u.mfr_active ? inPlan : live;
    const [counts, first, watch, engagements, deadlines, call, zone, products, own] = await Promise.all([
      one(db, `select count(*)::int as products, count(p.molecule_id)::int as matched,
        count(*) filter (where g.demand >= ${HIGH_DEMAND})::int as high,
        count(*) filter (where cm.registrants <= 3 and (cm.registrations > 0 or cm.on_national_list))::int as few,
        (select count(*)::int from projects l where l.user_id = $1) as launches,
        (select count(*)::int from mfr_files f where f.user_id = $1 and f.kind = 'gmp') as gmp
        from mfr_products p left join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = $2
        left join visible_gap_scores g on g.molecule_id = p.molecule_id and g.country = $2 where p.user_id = $1`, [u.id, focus]),
      rows(db, `${mfrProductsSql(focus)} where p.user_id = $1 and cm.rankable and cm.on_national_list
        order by g.score desc nulls last, cm.registrants, p.name limit 200`, [u.id]).then((r) => byMolecule(r).slice(0, full ? 5 : 3)),   // one row per molecule
      watchMarkets.length ? rows(db, 'select * from my_market_watch($1, 90)', [watchMarkets]) : [],
      rows(db, `select id, kind, country, stage from engagements where user_id = $1 and status = 'open' order by updated_at desc limit 5`, [u.id]),
      rows(db, `select o.kind, o.due_date, o.country, p.name from obligations o left join mfr_products p on p.id = o.product_id
        where o.user_id = $1 and not o.done order by o.due_date limit 5`, [u.id]),
      one(db, `select starts_at, meeting_link from call_bookings where user_id = $1 and status = 'booked' and starts_at > now()
                                order by starts_at limit 1`, [u.id]),
      one(db, 'select timezone from call_settings where id = 1').then((z) => z?.timezone ?? 'UTC'),
      profile?.sample_product_id ? [] : rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p
        left join molecules m on m.id = p.molecule_id where p.user_id = $1 and p.molecule_id is not null order by 2 limit 200`, [u.id]),
      one(db, `select count(*)::int as n, array_agg(distinct r.country) as markets from registrations r
        join manufacturer_profiles mp on mp.user_id = $1 where r.active and r.manufacturer_id = any(mp.company_ids)`, [u.id]),
    ]);
    // the outcome line: what is moving for them right now
    const outcome = await one(db, `select
        (select count(*)::int from engagements e where e.user_id = $1 and e.status = 'open' and e.kind in ('market_entry', 'partner_intro')) as intros,
        (select count(*)::int from engagements e where e.user_id = $1 and e.status = 'open' and e.kind = 'dossier_review') as reviews,
        (select count(*)::int from tenders t where t.stage = 'open' and t.closing between current_date and current_date + 30 and t.country = any($2)
           and exists (select 1 from mfr_products p where p.user_id = $1 and p.molecule_id = any(t.molecule_ids))) as closing,
        (select count(*)::int from projects pr where pr.user_id = $1 and pr.stage not in ('launched', 'parked')) as projects,
        (select count(distinct r.id)::int from registration_history h join registrations r on r.id = h.registration_id
           where h.created_at > now() - interval '30 days' and r.country = any($2) and r.molecule_id in (select molecule_id from mfr_products where user_id = $1 and molecule_id is not null)) as moved`,
      [u.owner_id ?? u.id, targets]);
    return { profile, targets, focus, full, counts, first, watch, engagements, deadlines, products, call, zone, mine: own?.n ?? 0, mineMarkets: (own?.markets ?? []) as string[], outcome };
  });
  const p = d.profile;
  const full = d.full;
  const watch = groupWatch(d.watch);
  const shownWatch = watchAll ? watch.slice(0, 8) : watch.slice(0, 2);
  // getting set up: the few things that make the portal useful, ticked off as they are done
  const setup: [boolean, string, string][] = [
    [Number(d.counts?.products) > 0, 'Add your products', '/m/products#add'],
    [Number(p?.profile_bits) > 0, 'Add your certifications and dosage forms', '/m/onboarding?step=2'],
    [Boolean(p?.sample_product_id) || u.mfr_tier >= 2, 'Open one product in full, free', '#free-read'],
    [Number(d.counts?.launches) > 0, 'Start a market entry project', '/m/projects'],
    [Boolean(p?.chosen_plan || p?.active_plan), 'Pick your plan', '/m/plan'],
    [Boolean(p?.verified_at) || Number(d.counts?.gmp) > 0, 'Upload your GMP certificate for the Verified badge', '/m/products#files'],
  ];
  const doneN = setup.filter(([ok]) => ok).length;
  return (
    <Shell user={u} title={<>{p?.company_name ? p.company_name : 'Welcome'}{p?.verified_at && <span className="pill blue" style={{ marginLeft: 12, verticalAlign: 'middle', fontSize: 13, letterSpacing: 'normal', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}><VerifiedIcon /> {t('Verified manufacturer')}</span>}</>}
      sub={t('Your products in {markets}', { markets: d.targets.map((c) => t(countryName(c))).join(', ') })}
      actions={<><Link className="btn btn-ghost btn-sm" href="/m/products#add">{t('Add a product')}</Link><Link className="btn btn-blue btn-sm" href="/m/services">{t('Get help')}</Link></>}>
      <Flash sp={sp} />
      {p?.status === 'pending' && <div className="note">Our team is reviewing your company. Everything is open to explore; introductions start once you are approved.</div>}
      {sp.welcome && <div className="ok">{d.mine ? `Welcome. We found ${d.mine} ${d.mine === 1 ? 'registration' : 'registrations'} under your company in ${d.mineMarkets.map(countryName).join(', ')}; they are in your portfolio, marked as yours. `
        : 'Welcome. '}{d.counts?.products ? `Your ${d.counts.products} products are matched to your markets below.` : 'Add your products and we match them to your markets in seconds.'}
        {u.mfr_trial && u.mfr_trial_until ? ` Basic Market Data is open for you on ${countryName(u.mfr_markets[0])} until ${fmtDate(u.mfr_trial_until)}, free.` : ''}</div>}
      {!sp.welcome && u.mfr_trial && u.mfr_trial_until && <div className="note">{t('Trial: Basic Market Data on {market} until {date}.', { market: t(countryName(u.mfr_markets[0])), date: fmtDate(u.mfr_trial_until) })} <Link href="/m/plan">{t('See the plans')}</Link></div>}

      {d.outcome && (d.outcome.intros + d.outcome.reviews + d.outcome.closing + d.outcome.projects + d.outcome.moved > 0) && (
        <section className="card between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {d.outcome.projects > 0 && <Link href="/m/projects"><b className="num">{d.outcome.projects}</b> {t(d.outcome.projects === 1 ? 'project in progress' : 'projects in progress')}</Link>}
            {d.outcome.intros > 0 && <Link href="/m/activity"><b className="num">{d.outcome.intros}</b> {t(d.outcome.intros === 1 ? 'introduction in progress' : 'introductions in progress')}</Link>}
            {d.outcome.reviews > 0 && <Link href="/m/activity"><b className="num">{d.outcome.reviews}</b> {t(d.outcome.reviews === 1 ? 'dossier under review' : 'dossiers under review')}</Link>}
            {d.outcome.closing > 0 && <Link href="/m/tenders?show=desk"><b className="num">{d.outcome.closing}</b> {t(d.outcome.closing === 1 ? 'tender closing this month' : 'tenders closing this month')}</Link>}
            {d.outcome.moved > 0 && <Link href="/m/inbox"><b className="num">{d.outcome.moved}</b> {t(d.outcome.moved === 1 ? 'registration moved on your molecules' : 'registrations moved on your molecules')}</Link>}
          </span>
          <Link className="btn-link small" href="/m/calendar">{t('Calendar')}</Link>
        </section>)}
      {doneN < setup.length && (
        <section className="card stack" style={{ gap: 10 }}>
          <div className="between"><h2>{t('Get set up')} · {t('{n} of {total}', { n: doneN, total: setup.length })}</h2>
            <form action={tourGo}><input type="hidden" name="step" value="1" /><button className="btn btn-ghost btn-sm" type="submit">{t('Take the tour')}</button></form></div>
          <div className="meter"><i style={{ width: `${(100 * doneN) / setup.length}%` }} /></div>
          <div className="grid g3" style={{ gap: 8 }}>{setup.map(([ok, label, href]) => ok
            ? <span key={label} className="small muted">✓ {t(label)}</span>
            : <Link key={label} href={href} className="small">{t(label)} →</Link>)}</div>
        </section>)}
      <div className="grid g4">
        <Link className="tile t-white" href="/m/products"><span className="k">{t('Your products')}</span><span className="v num">{d.counts?.products}</span>
          <span className="small">{t('{n} matched', { n: d.counts?.matched ?? 0 })}</span></Link>
        <Link className="tile t-peach" href="/m/products"><span className="k"><DemandIcon /> {t('In high demand')}</span><span className="v num">{d.counts?.high}</span>
          <span className="small">{t('in {market}', { market: t(countryName(d.focus)) })}</span></Link>
        <Link className="tile t-mint" href="/m/products"><span className="k">{t('Little or no competition')}</span><span className="v num">{d.counts?.few}</span>
          <span className="small">{t('3 competitors or fewer')}</span></Link>
        <Link className="tile t-blue" href="/m/projects"><span className="k">{t('Projects')}</span><span className="v num">{d.counts?.launches}</span>
          <span className="small">{t('products and markets')}</span></Link>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card" data-tour="home">
            <div className="card-h"><div><h2>{t('Register these first')}</h2><p className="note">{t('The clearest openings for your products in {market}.', { market: t(countryName(d.focus)) })}</p></div>
              <Link className="btn-link" href="/m/products">{t('All products')}</Link></div>
            {d.counts?.products === 0 ? (
              <div className="between" style={{ flexWrap: 'wrap' }}><span className="muted">{t('Add your products and we rank them against the market.')}</span>
                <Link className="btn btn-blue btn-sm" href="/m/products#add">{t('Add products')}</Link></div>
            ) : d.first.length === 0 ? <Empty>{t('None of your matched products is on the official essential list yet.')}</Empty> : (
              <div>{d.first.map((x, i) => (
                <Link key={x.id} href={`/m/products/${x.id}?market=${d.focus}`} className="between"
                  style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 0', borderTop: i ? '1px solid var(--line)' : undefined, textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                    <span className="nm">{x.inn ?? x.name}</span>
                    {x.variants && <div className="sub2">{x.packs > 1 ? `${x.packs} products · ` : ''}{x.variants}</div>}
                    <div className="sub2">{cap(reasons(x).join(' · '))}</div>
                    <div style={{ marginTop: 6 }}><Badges m={x} /></div>
                  </div>
                  <span className="small">{t('Open →')}</span>
                </Link>))}</div>)}
            {!full && d.first.length > 0 && <div style={{ marginTop: 12 }}><PlanLock compact need="data" title={t('See your full ranking')} /></div>}
          </section>

          <section className="card">
            <div className="card-h"><div><h2>{t('Market watch')}</h2><p className="note">{t('What moved in your molecules in the last 90 days.')}</p></div></div>
            {d.watch.length === 0 ? <Empty>{t('Quiet: no changes in your molecules in the last 90 days.')}</Empty> : (
              <div>{shownWatch.map((w, i) => (
                <div key={i} className="between small" style={{ padding: '10px 0', borderTop: i ? '1px solid var(--line)' : undefined, gap: 12 }}>
                  <span><b>{w.n > 1 ? t(WATCH_MANY[w.change] ?? '{n} changes', { n: w.n }) : t(WATCH[w.change] ?? cap(w.change))}</b> · {w.molecule} · {t(countryName(w.country))}{w.made.length ? <span className="muted"> · {t('made in')} {w.made.slice(0, 3).join(', ')}{w.made.length > 3 ? ` +${w.made.length - 3}` : ''}</span> : null}</span>
                  <span className="muted num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(w.at)}</span>
                </div>))}</div>)}
            {!watchAll && watch.length > shownWatch.length && (
              <div style={{ marginTop: 12 }}><PlanLock need="data" title={t('{n} more changes in your molecules', { n: watch.length - shownWatch.length })}>
                {t('Every new competitor, exit and lapsed registration in your molecules, in all your markets.')}</PlanLock></div>)}
          </section>
        </div>

        <div className="stack">
          <section className="card stack">
            <div className="between"><h2>{t('Your plan')}</h2><Link className="btn-link" href="/m/plan">{t('Plans')}</Link></div>
            {p?.active_plan ? <p><b>{t(MFR_PLANS[p.active_plan as keyof typeof MFR_PLANS]?.name)}</b> <span className="pill solid">{t('Active')}</span></p>
              : p?.chosen_plan ? <p><b>{t(MFR_PLANS[p.chosen_plan as keyof typeof MFR_PLANS]?.name)}</b> <span className="pill blue">{t('Requested')}</span></p>
              : <><p>{t('Suggested for you:')} <b>{t(MFR_PLANS[(p?.suggested_plan ?? 'data') as keyof typeof MFR_PLANS]?.name)}</b></p>
                <Link className="btn btn-blue btn-sm" href="/m/plan" style={{ alignSelf: 'flex-start' }}>{t('See plans')}</Link></>}
          </section>

          <section className="card stack" style={{ gap: 8 }}>
            <h2>{t('Talk to our team')}</h2>
            {d.call ? (<p className="small">Your call: <b><LocalTime iso={new Date(d.call.starts_at).toISOString()} zone={d.zone} /></b>
                {d.call.meeting_link ? <> · <a href={d.call.meeting_link} target="_blank" rel="noopener noreferrer">{t('Join')}</a></> : null}</p>)
              : <p className="small muted">{t('A short call about your markets, products or plan, at a time that suits you.')}</p>}
            <Link className="btn btn-ghost btn-sm" href="/m/call" style={{ alignSelf: 'flex-start' }}>{d.call ? t('See or change') : t('Book a call')}</Link>
          </section>
          {!u.whatsapp && (
            <section className="card stack" style={{ gap: 8 }}>
              <h2>{t('Updates on WhatsApp')}</h2>
              <p className="small muted">{t('A short weekly summary, new competitors in the molecules you watch, and news on your projects.')}</p>
              <Link className="btn btn-ghost btn-sm" href="/settings" style={{ alignSelf: 'flex-start' }}>{t('Add your WhatsApp number')}</Link>
            </section>)}
          {!p?.verified_at && Number(d.counts?.gmp) > 0 && (
            <section className="card stack" style={{ gap: 6 }}>
              <span className="pill lav" style={{ alignSelf: 'flex-start' }}><VerifiedIcon /> {t('Verified badge')}</span>
              <p className="small muted">{t('We are checking your GMP certificate. Once checked, the Verified manufacturer badge shows on your account and your market reads.')}</p>
            </section>)}
          {!p?.sample_product_id && u.mfr_tier < 2 && d.products.length > 0 && (
            <section className="card stack" id="free-read">
              <h2>{t('One product, fully open')}</h2>
              <p className="muted">{t('Pick one product and see everything we have on it, free: competition, distributors, route and price.')}</p>
              <form action={chooseSample} className="row">
                <select className="input" name="product_id" aria-label={t('Product')} style={{ flex: '1 1 160px' }}>
                  {d.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <button className="btn btn-blue btn-sm" type="submit">{t('Open it')}</button>
              </form>
              <span className="note">{t('One product, once.')}</span>
            </section>)}

          <section className="card stack">
            <div className="between"><h2>{t('Your markets')}</h2><Link className="btn-link" href="/m/onboarding?step=3">{t('Edit')}</Link></div>
            {d.targets.map((c) => (
              <div key={c} className="between"><span>{t(countryName(c))}</span>
                {hasData(c) ? <Link className="small" href={`/m/market?market=${c}`}>{t('Open →')}</Link> : <ManagedBadge />}</div>))}
            {canUse(u.mfr_tier, 'market_read') && <Link className="btn btn-ghost btn-sm" href={`/m/report?market=${d.focus}`} style={{ alignSelf: 'flex-start' }}>{t('Download a market read')}</Link>}
          </section>

          {(d.engagements.length > 0 || d.deadlines.length > 0) && (
            <section className="card stack">
              <h2>{t('In progress')}</h2>
              {d.engagements.map((e) => (
                <Link key={e.id} href={`/m/engagements/${e.id}`} className="between small"><span>{SERVICES[e.kind].label}{e.country ? ` · ${countryName(e.country)}` : ''}</span>
                  <StagePill stage={e.stage} /></Link>))}
              {d.deadlines.map((o, i) => (
                <div key={i} className="between small"><span>{OBLIGATION_KINDS[o.kind]}{o.name ? ` · ${o.name}` : ''} · {countryName(o.country)}</span>
                  <span className="num">{fmtDate(o.due_date)}</span></div>))}
            </section>)}
          <p className="note">{t('A question?')} <Link href="/expert">{t('Ask our team')}</Link>.</p>
        </div>
      </div>
    </Shell>
  );
}
