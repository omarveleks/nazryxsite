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
import { PRICE_SQL, packOf, priceBasis, unitShort, unitWord, usd, type MoleculePrice } from '@/lib/prices';
import { AGENCY_KINDS, LAUNCH_STAGES, MFR_PLANS, NEEDS_PLAN, SERVICES, canUse, tierIn, countryName, mfrProductsSql, productClass, reasons } from '@/lib/mfr';

export const metadata = { title: 'Product' };

// One product against one market (or all of them): why it fits, the route, the price, the distributors who could take it.
export default async function MfrProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; market?: string; added?: string; sample?: string; exw?: string; units?: string }> }) {
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
    // distributors strong in the class who do not carry this molecule yet (codes only; names stay with Nazryx)
    const open = canUse(t, 'matching') && p.category ? (await rows(db, 'select carries from partner_search($1, $2, $3)', [market, p.category, p.molecule_id]))
      .filter((x) => !x.carries).length : null;
    // public tenders for this molecule in this market
    const tenders = canUse(t, 'market') && p.molecule_id ? await rows(db, `select id, coalesce(title_en, title) as title, coalesce(buyer_en, buyer) as buyer, stage, coalesce(awarded, closing, published) as at, quantity,
        unit_price, value, currency, bidders, url from tenders where country = $2 and $1 = any(molecule_ids)
        order by coalesce(awarded, closing, published) desc nulls last limit 6`, [p.molecule_id, market]) : [];
    // the molecule's average price in this market: listings, or an estimate from a neighbouring market
    const avg = canUse(t, 'market') ? await one(db, `${PRICE_SQL} where molecule_id = $1 and country = $2`, [p.molecule_id, market]) as MoleculePrice | null : null;
    // a market with only one or two products prices the brand; a generic usually enters lower (measured on lists that say which is which)
    const costs = avg ? await one(db, 'select freight, duty, distributor, pharmacy, vat from market_costs where country = $1', [market]) : null;
    const brands = avg ? await one(db, `select (select registrants from country_molecules where molecule_id = $1 and country = $2) as registrants,
        (select value from price_factors where key = 'generic_vs_originator') as generic`, [p.molecule_id, market]) : null;
    return { ...base, origin, lapsed, route, open, tenders, brands, costs, ...(canUse(t, 'market') ? { avg } : {}) };
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
          </>)}
          {'avg' in d && (d.avg ? (
            <section className="card stack">
              <div className="card-h"><h2>Price in {countryName(market)}</h2>
                <span className={`pill ${d.avg.basis === 'estimate' ? 'peach' : 'mint'}`}>{d.avg.basis === 'estimate' ? 'Estimate' : 'Market data'}</span></div>
              <div className="grid g3">
                {([['Low', d.avg.lo, 't-mint'], ['Average', d.avg.unit_price, 't-blue'], ['Premium', d.avg.hi, 't-lav']] as const).map(([k, v, tone]) => (
                  <div key={k} className={`tile ${tone}`}><span className="k">{k}</span>
                    <span className="v num" style={{ fontSize: 22 }}>{v != null ? `${d.avg!.currency} ${fmtMoney(Number(v) * packOf(d.avg!))}` : '—'}</span>
                    <span className="small">per {unitWord(d.avg!)}{k === 'Average' ? ` · ${usd(Number(d.avg!.unit_usd) * packOf(d.avg!))}` : ''}</span></div>))}
              </div>
              <p className="small muted">{priceBasis(d.avg)}</p>
              {d.brands?.registrants != null && Number(d.brands.registrants) <= 2 && Number(d.brands.generic) < 1 && (
                <p className="small"><span className="pill peach">Few products</span> Only {d.brands.registrants} {Number(d.brands.registrants) === 1 ? 'product is' : 'products are'} registered here, so these prices are mostly the brand&rsquo;s. A generic usually enters about {Math.round((1 - Number(d.brands.generic)) * 100)}% lower: around <b>{d.avg.currency} {fmtMoney(Number(d.avg.unit_price) * packOf(d.avg) * Number(d.brands.generic))}</b> per {unitWord(d.avg)}.</p>)}
              {d.avg.by_strength.length > 1 && (
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Strength</th><th className="r">Per {unitShort(d.avg)}</th><th className="r">Per pack</th><th className="r">Prices</th></tr></thead>
                  <tbody>{d.avg.by_strength.map((x) => <tr key={x.strength}><td>{x.strength}</td><td className="r num">{fmtMoney(x.unit)}</td><td className="r num">{fmtMoney(x.pack)}</td><td className="r num">{x.n}</td></tr>)}</tbody></table></div>)}
            </section>) : (
            <section className="card between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <span><b>Price in {countryName(market)}</b><div className="small muted">No public price for this medicine yet. We check it for you within 24 hours.</div></span>
              <Link className="btn btn-ghost btn-sm" href="/m/call?topic=market_entry">Ask for a price</Link>
            </section>))}
          {'avg' in d && d.avg && 'costs' in d && d.costs && <MarginCheck p={d.avg} c={d.costs} id={id} market={market} exw={sp.exw} units={sp.units} />}
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


// What a manufacturer can charge ex-works and still sell at the market's prices: the shelf price taken back through VAT,
// the pharmacy and distributor mark-ups, duty and freight. With their own ex-works price, where it lands on the shelf.
function MarginCheck({ p, c, id, market, exw, units }: { p: MoleculePrice; c: Record<string, string>; id: number; market: string; exw?: string; units?: string }) {
  const chain = ['freight', 'duty', 'distributor', 'pharmacy', 'vat'].reduce((m, k) => m * (1 + Number(c[k])), 1);
  const perUSD = Number(p.unit_price) / Number(p.unit_usd);                 // local currency per US dollar
  const liquid = p.unit === 'ml' || p.unit === 'g';
  const pack = Number(units) > 0 ? Number(units) : liquid ? packOf(p) : 30;
  const word = liquid ? `${fmtMoney(pack)} ${p.unit}` : `${fmtMoney(pack)} ${unitShort(p)}s`;
  const target = (Number(p.unit_usd) / chain) * pack;                     // USD per pack, ex-works, to sell at the average
  const mine = Number(exw) > 0 ? Number(exw) : null;
  const shelf = mine != null ? (mine / pack) * chain * perUSD : null;      // local currency per unit on the shelf
  const lo = Number(p.lo ?? p.unit_price), hi = Number(p.hi ?? p.unit_price), avg = Number(p.unit_price);
  const where = shelf == null ? null : shelf <= lo ? ['mint', 'Cheapest on the shelf'] : shelf <= avg ? ['mint', 'Competitive']
    : shelf <= hi ? ['peach', 'Premium end'] : ['peach', 'Above the market'];
  const pct = (k: string) => `${Math.round(Number(c[k]) * 100)}%`;
  return (
    <section className="card stack">
      <h2>Margin check</h2>
      <p>To sell at the market average, your ex-works price can be up to <b>${target < 1 ? target.toFixed(3) : fmtMoney(target)}</b> per {word}.</p>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <input type="hidden" name="market" value={market} />
        <label className="small" style={{ flex: '1 1 140px' }}>Your ex-works price (USD per pack)
          <input className="input" name="exw" type="number" step="any" min="0" defaultValue={exw ?? ''} placeholder={target.toFixed(2)} /></label>
        <label className="small" style={{ flex: '1 1 110px' }}>{liquid ? `Pack size (${p.unit})` : 'Units per pack'}
          <input className="input" name="units" type="number" step="any" min="0" defaultValue={units ?? String(pack)} /></label>
        <button className="btn btn-blue btn-sm" type="submit">Check</button>
      </form>
      {shelf != null && where && mine != null && (
        <div className="grid g3">
          <div className="tile t-blue"><span className="k">Your shelf price</span><span className="v num" style={{ fontSize: 22 }}>{p.currency} {fmtMoney(shelf * (liquid ? pack : 1))}</span>
            <span className="small">per {liquid ? word : unitShort(p)}</span></div>
          <div className={`tile t-${where[0]}`}><span className="k">Position</span><span className="v" style={{ fontSize: 20 }}>{where[1]}</span>
            <span className="small">market {p.currency} {fmtMoney(lo * (liquid ? pack : 1))}–{fmtMoney(hi * (liquid ? pack : 1))}</span></div>
          <div className="tile t-lav"><span className="k">Headroom</span><span className="v num" style={{ fontSize: 22 }}>{Math.round(((target - mine) / mine) * 100)}%</span>
            <span className="small">{target >= mine ? 'room to raise your price or margins' : 'cut needed to reach the average'}</span></div>
        </div>)}
      <p className="small muted">Assumes freight {pct('freight')}, duty and fees {pct('duty')}, distributor {pct('distributor')}, pharmacy {pct('pharmacy')}, VAT {pct('vat')}. Shelf prices are {p.basis === 'estimate' ? 'estimated' : 'from the market'}.</p>
    </section>
  );
}
