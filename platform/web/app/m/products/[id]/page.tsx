import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Badges, Empty, Flash, LockIcon, PlanLock } from '@/components/ui';
import { deleteMfrProduct, saveLaunch, unwatchMolecule, updateProductChecks, watchMolecule } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { BE_STATUS, beSuggestion, fmtDate, fmtMoney, levelLabel, registeredLine } from '@/lib/format';
import { REQ_SQL, forProduct, type Requirement } from '@/lib/regulatory';
import { AGENCY_KINDS, LAUNCH_STAGES, MFR_PLANS, NEEDS_PLAN, SERVICES, canUse, tierIn, countryName, mfrProductsSql, productClass, reasons } from '@/lib/mfr';

export const metadata = { title: 'Product' };

// One product against one market (or all of them): why it fits, the route, the price, the distributors who could take it.
export default async function MfrProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; market?: string; added?: string; sample?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, sample_product_id, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    // the free full read opens every section for one product
    const sampled = prof?.sample_product_id === id;
    const targets = targetMarkets(prof?.target_countries);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const t = sampled ? 3 : tierIn(u, market);
    const focus = hasData(market) ? market : targets.find(hasData) ?? 'TZ';
    const p = await one(db, `${mfrProductsSql(focus)} where p.id = $1 and p.user_id = $2`, [id, u.id]);
    if (!p) return null;
    const launches = await rows(db, 'select id, country, stage from launches where product_id = $1 and user_id = $2', [id, u.id]);
    const reqs = forProduct(await rows(db, REQ_SQL, [market]) as Requirement[], { ...p, category: productClass(p) });
    const watched = p.molecule_id ? Boolean(await one(db, 'select 1 as x from watches where user_id = $1 and molecule_id = $2', [u.id, p.molecule_id])) : false;
    const base = { p, targets, market, t, sampled, launches, reqs, watched };
    if (!p.molecule_id) return base;
    if (!hasData(market)) return base;
    const origin = canUse(t, 'market') ? await rows(db, `select initcap(lower(coalesce(manufacturing_country, 'not stated'))) as country, count(*)::int as n
        from registrations where molecule_id = $1 and country = $2 and active group by 1 order by n desc limit 5`, [p.molecule_id, market]) : null;
    const lapsed = canUse(t, 'market') ? Number((await one(db, `select count(*)::int as n from registrations where molecule_id = $1 and country = $2 and not active`,
      [p.molecule_id, market]))?.n ?? 0) : null;
    const routeKey = (await one(db, 'select route_key from molecule_routes where molecule_id = $1', [p.molecule_id]))?.route_key
      ?? (p.who_pq || p.sra_approved ? 'abridged' : 'full');
    const route = canUse(t, 'pathway') ? await one(db, 'select label, description, months_low, months_high from registration_routes where key = $1', [routeKey]) : null;
    const price = canUse(t, 'pricing') ? await one(db, `select price_low, price_high, currency, unit, note from market_prices where molecule_id = $1 and kind = 'suggested'
        order by observed_at desc limit 1`, [p.molecule_id]) : null;
    // distributors strong in the class who do not carry this molecule yet (codes only; names stay with Nazryx)
    const open = canUse(t, 'matching') && p.category ? (await rows(db, 'select carries from partner_search($1, $2, $3)', [market, p.category, p.molecule_id]))
      .filter((x) => !x.carries).length : null;
    // public tenders for this molecule in this market, and the official price caps where the market publishes them
    const tenders = canUse(t, 'market') && p.molecule_id ? await rows(db, `select id, title, buyer, stage, coalesce(awarded, closing, published) as at, quantity,
        unit_price, value, currency, bidders, url from tenders where country = $2 and $1 = any(molecule_ids)
        order by coalesce(awarded, closing, published) desc nulls last limit 6`, [p.molecule_id, market]) : [];
    const caps = canUse(t, 'pricing') && p.molecule_id ? await one(db, `select count(*)::int as n, min(max_retail) as lo, max(max_retail) as hi, min(currency) as cur
        from reference_prices where molecule_id = $1 and country = $2 and max_retail > 0`, [p.molecule_id, market]) : null;
    return { ...base, origin, lapsed, route, price, open, tenders, caps };
  });
  if (!d) notFound();
  const { p, market } = d;
  const be = p.be_study ? null : beSuggestion(p.forms ?? p.dosage_form);
  const cls = productClass(p);
  return (
    <Shell user={u} title={p.inn ?? p.name} crumb={<><Link href="/m/products">My products</Link> / {p.inn ?? p.name}</>}
      sub={[p.inn ? p.name : null, cls].filter(Boolean).join(' · ') || 'Product'}
      actions={<Link className="btn btn-blue btn-sm" href={`/m/services?product=${id}`}>Get help with this product</Link>}>
      <Flash sp={sp} />
      {d.sampled && <div className="ok" role="status">Your free full read: every section of this product is open.</div>}
      {sp.added && <div className="ok" role="status">Added. {p.molecule_id ? 'Here is how it fits your markets.' : 'Our team is matching it to the market.'}</div>}
      <MarketPicker u={u} targets={d.targets} current={market} path={`/m/products/${id}`} />
      <div className="split">
        <div className="stack">
          {!p.molecule_id ? (
            <section className="card stack"><h2>Not matched yet</h2>
              <p className="muted">Our team is matching &ldquo;{p.name}&rdquo; to the market. You can still ask for any service in the meantime.</p></section>
          ) : !hasData(market) ? <AgencyMarket code={market} /> : (<>
            <section className="card stack" data-tour="product">
              <div className="card-h"><h2>Why {countryName(market)}</h2>{p.registrants != null && <Badges m={p} />}</div>
              {p.registrants == null ? <Empty>Not registered in {countryName(market)} and not on its official lists yet.</Empty> : (
                <table className="tbl"><tbody>
                  <tr><td>Official list</td><td className="r">{p.on_national_list ? (p.facility_level ? `Level ${p.facility_level}: ${levelLabel(p.facility_level)}` : 'Yes') : 'No'}</td></tr>
                  <tr><td>WHO essential list</td><td className="r">{p.on_who_eml ? 'Yes' : 'No'}</td></tr>
                  <tr><td>Competition</td><td className="r">{registeredLine(p.registrants, p.registrations)}</td></tr>
                  {'origin' in d && d.origin ? (<>
                    <tr><td>Registered products made in</td><td className="r">{d.origin.length ? d.origin.map((o) => `${o.country} ${o.n}`).join(', ') : 'Nowhere yet'}</td></tr>
                    <tr><td>Made by factories in {countryName(market)}</td><td className="r">{Number(p.local_made) > 0 ? `${p.local_made} products` : 'None'}</td></tr>
                    <tr><td>Registrations lapsed or cancelled</td><td className="r">{d.lapsed}</td></tr>
                  </>) : <tr><td colSpan={2}><PlanLock compact need="data" title="Where competitors make it, and lapsed registrations" u={u} market={market} /></td></tr>}
                </tbody></table>)}
              {p.registrants != null && <p className="note">In short: {reasons(p).join(', ')}.</p>}
            </section>
            <section className="card stack">
              <h2>Distributors who could take it on</h2>
              {'open' in d && d.open != null ? (<>
                <p><b className="num">{d.open}</b> distributors are strong in {p.category ?? 'this class'} and do not carry {p.inn} yet.</p>
                <Link className="btn btn-ghost btn-sm" href={`/m/partners?market=${market}&class=${encodeURIComponent(p.category ?? '')}&molecule=${p.molecule_id}&gap=1`}
                  style={{ alignSelf: 'flex-start' }}>See them</Link></>)
                : <PlanLock need="access" title="Distributor matching for this product" u={u} market={market}>Which distributors are strong in this class and do not carry it yet, ready for an introduction.</PlanLock>}
            </section>
            <section className="card stack">
              <h2>Pathway to approval</h2>
              {'route' in d && d.route ? <p><b>{d.route.label}</b>{d.route.months_low != null ? `: about ${d.route.months_low}–${d.route.months_high ?? d.route.months_low} months` : ''}. <span className="muted">{d.route.description}</span></p>
                : <PlanLock need="access" title="Route and timeline" u={u} market={market}>The registration route for this product, what it needs and how long it takes.</PlanLock>}
              <p className="muted">{p.be_study ? 'You have a bioequivalence study.' : be ? `${BE_STATUS[be]}.` : 'Whether a bioequivalence study is needed: we confirm it when we check your dossier.'}</p>
            </section>
            <section className="card stack">
              <h2>Suggested selling price</h2>
              {!canUse(d.t, 'pricing') ? <PlanLock need="access" title="Pricing analysis" u={u} market={market}>The price band we suggest for this product in {countryName(market)}.</PlanLock>
                : 'price' in d && d.price ? <p><b>{d.price.currency} {Number(d.price.price_low).toFixed(2)}–{Number(d.price.price_high).toFixed(2)}</b> per {d.price.unit}{d.price.note ? ` · ${d.price.note}` : ''}</p>
                : <p className="note">Our team is setting it. Ask for a price check and we answer within 24 hours.</p>}
              {'caps' in d && d.caps?.n ? <p className="small">Official maximum retail price in {countryName(market)}: <b>{d.caps.cur} {fmtMoney(d.caps.lo)}{d.caps.hi !== d.caps.lo ? `–${fmtMoney(d.caps.hi)}` : ''}</b> across {d.caps.n} registered {d.caps.n === 1 ? 'pack' : 'packs'}.</p> : null}
            </section>
          </>)}
          {'tenders' in d && d.tenders.length > 0 && (
            <section className="card stack">
              <div className="card-h"><h2>Public tenders in {countryName(market)}</h2><Link className="btn-link" href={`/m/tenders?market=${market}`}>All tenders</Link></div>
              {d.tenders.map((x, i) => (
                <Link key={i} href={`/m/tenders/${x.id}`} className="between small" style={{ borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 8 : 0, gap: 12, flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ minWidth: 0, flex: '1 1 260px' }}><b>{x.title}</b><div className="sub2">{x.buyer ?? ''}{x.at ? ` · ${fmtDate(x.at)}` : ''}</div></span>
                  <span className="r">{x.quantity ? `${fmtMoney(x.quantity)} units` : ''}{x.unit_price ? ` at ${x.currency ?? ''} ${fmtMoney(x.unit_price)}` : x.value ? `${x.currency ?? ''} ${fmtMoney(x.value)}` : ''}
                    <div><span className={`pill ${x.stage === 'open' ? 'mint' : ''}`}>{x.stage === 'open' ? 'Open' : x.stage === 'awarded' ? `Awarded${x.bidders ? ` · ${x.bidders} ${x.bidders === 1 ? 'bid' : 'bids'}` : ''}` : 'Closed'}</span></div></span>
                </Link>))}
            </section>)}
          <section className="card stack">
            <div className="card-h"><h2>Requirements in {countryName(market)}</h2><Link className="btn-link" href={`/m/regulatory?market=${market}&product=${id}#p${id}`}>All requirements</Link></div>
            {!canUse(d.t, 'requirements') ? <PlanLock need="access" title="What this product needs" u={u} market={market}>Bioequivalence, sterile, controlled or biological: the steps this product needs on top of the market&rsquo;s general requirements.</PlanLock>
              : d.reqs.length === 0 ? <p className="muted">Only the market&rsquo;s general requirements apply.</p>
              : d.reqs.map((r) => <div key={r.id}><b>{r.title}</b> <span className="pill peach">{r.topic}</span><div className="small muted">{r.body}</div></div>)}
          </section>
          <section className="card stack">
            <h2>Your dossier for this product</h2>
            <p className="note">Tell us what you have. It sets the likely route; we check the documents themselves before filing.</p>
            <form action={updateProductChecks} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="product_id" value={id} />
              {[['who_pq', 'WHO prequalified'], ['sra_approved', 'Approved by a stringent regulator (EU, US, UK, Japan ...)'], ['ctd_ready', 'Dossier in CTD format'],
                ['be_study', 'Bioequivalence study available'], ['zone_ivb', 'Stability data for climatic zone IVb']].map(([k, l]) => (
                <label key={k} className="row small" style={{ gap: 8 }}><input type="checkbox" name={k} defaultChecked={p[k]} /> {l}</label>))}
              <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Save</button>
            </form>
          </section>
        </div>
        <div className="stack">
          <section className="card stack">
            <h2>What we can do for it</h2>
            {AGENCY_KINDS.map((k) => {
              const ok = canUse(u.mfr_tier, k);
              return (
                <Link key={k} href={ok ? `/m/services/${k}?product=${id}` : `/m/plan?want=${NEEDS_PLAN[k]}`} className="between"
                  style={{ padding: '8px 0', textDecoration: 'none', alignItems: 'flex-start', gap: 10 }}>
                  <span>{SERVICES[k].label}{!ok && <span className="sub2" style={{ display: 'block' }}>In {MFR_PLANS[NEEDS_PLAN[k]].name}</span>}</span>
                  {ok ? <span className="small" style={{ whiteSpace: 'nowrap' }}>Open →</span> : <span className="pill lav"><LockIcon /> Locked</span>}
                </Link>);
            })}
          </section>
          {p.molecule_id && (
            <section className="card stack">
              <h2>Competitor watch</h2>
              {!canUse(u.mfr_tier, 'competitors') ? <PlanLock compact need="data" title="Alert me to new competitors" />
                : <form action={d.watched ? unwatchMolecule : watchMolecule} className="between" style={{ gap: 10 }}>
                  <input type="hidden" name="molecule_id" value={p.molecule_id} /><input type="hidden" name="return" value={`/m/products/${id}`} />
                  <span className="small">{d.watched ? 'Watching: you hear the week a new competitor is registered.' : 'Hear the week a new competitor is registered.'}</span>
                  <button className={`btn btn-sm ${d.watched ? 'btn-ghost' : 'btn-blue'}`} type="submit">{d.watched ? 'Stop' : 'Watch'}</button>
                </form>}
            </section>)}
          <section className="card stack">
            <h2>Launch tracker</h2>
            {d.launches.length > 0 && <div className="stack" style={{ gap: 6 }}>{d.launches.map((l) => (
              <div key={l.id} className="between small"><span>{countryName(l.country)}</span><span className="pill blue">{LAUNCH_STAGES.find(([k]) => k === l.stage)?.[1]}</span></div>))}</div>}
            <form action={saveLaunch} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="product_id" value={id} /><input type="hidden" name="return" value={`/m/products/${id}`} />
              <div className="row">
                <select className="input" name="country" aria-label="Market" defaultValue={market} style={{ flex: '1 1 120px' }}>
                  {d.targets.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select>
                <select className="input" name="stage" aria-label="Stage" defaultValue="selected" style={{ flex: '1 1 140px' }}>
                  {LAUNCH_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </div>
              <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>{d.launches.length ? 'Update' : 'Add to the tracker'}</button>
            </form>
          </section>
          <form action={deleteMfrProduct}><input type="hidden" name="product_id" value={id} />
            <button className="btn-link small" type="submit">Remove this product</button></form>
        </div>
      </div>
    </Shell>
  );
}
