import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Badges, Empty, Flash, LockIcon, PlanLock } from '@/components/ui';
import { addCompetitors, deleteMfrProduct, removeCompetitor, setKind, setUseGroup, saveLaunch, toggleChecklist, unwatchMolecule, updateProductChecks, watchMolecule } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { BE_STATUS, beSuggestion, fmtDate, fmtMoney, levelLabel, registeredLine } from '@/lib/format';
import { DEVICE_REQ_SQL, REQ_SQL, appliesTo, forProduct, type Requirement } from '@/lib/regulatory';
import { PRICE_SQL, packOf, priceBasis, priceFits, unitShort, unitWord, usd, type MoleculePrice } from '@/lib/prices';
import { AGENCY_KINDS, LAUNCH_STAGES, MFR_PLANS, NEEDS_PLAN, SERVICES, canUse, tierIn, countryName, displayClass, mfrProductsSql, productClass, reasons } from '@/lib/mfr';
import { brandPresence, segmentBrands, type BrandRow } from '@/lib/competitors';
import { GROUP_LABEL, isDevice, productGroup } from '@/lib/segments';

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
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const t = sampled ? 3 : tierIn(u, market);
    const focus = hasData(market) ? market : targets.find(hasData) ?? 'TZ';
    const p = await one(db, `${mfrProductsSql(focus)} where p.id = $1 and p.user_id = $2`, [id, u.id]);
    if (!p) return null;
    const launches = await rows(db, 'select id, country, stage from launches where product_id = $1 and user_id = $2', [id, u.id]);
    // a medical device (viscoelastic, joint injection, nasal saline, a lubricant registered as a device) follows device rules
    const kind: 'medicine' | 'device' = isDevice(p) ? 'device' : 'medicine';
    const reqs = forProduct(await rows(db, kind === 'device' ? DEVICE_REQ_SQL : REQ_SQL, [market]) as Requirement[], { ...p, category: productClass(p) });
    const watched = p.molecule_id ? Boolean(await one(db, 'select 1 as x from watches where user_id = $1 and molecule_id = $2', [u.id, p.molecule_id])) : false;
    // competitor brands the manufacturer named, and others in the same use group (devices and medicines alike)
    const group: string | null = productGroup(p);
    const watchList = await rows(db, 'select id, brand from mfr_competitors where product_id = $1 and user_id = $2 order by created_at', [id, u.id]);
    const comp = hasData(market) ? {
      group, brands: await brandPresence(db, market, watchList as { id: number; brand: string }[]),
      others: group && canUse(t, 'market') ? await segmentBrands(db, market, group, watchList.map((w: any) => w.brand)) : [],
      costs: await one(db, 'select distributor, pharmacy, vat from market_costs where country = $1', [market]),
    } : null;
    const base = { p, targets, market, t, sampled, launches, reqs, watched, comp, kind };
    if (kind === 'device') {
      if (!hasData(market)) return base;
      const dRoutes = canUse(t, 'pathway') ? (await rows(db, `select key, label, description, months_low, months_high, fee_usd_low, fee_usd_high, eligibility
          from country_routes where country = $1 and scope = 'device' order by sort`, [market]))
          .filter((r) => r.eligibility !== 'sra_or_pq' || p.who_pq || p.sra_approved)
          // the risk class a device like this usually falls in: lubricants B, nasal saline A or B, viscoelastics C, joint injections C or D
          .filter((r) => { const cls = DEVICE_CLASS[group ?? ''] ?? null; const k = String(r.key).replace(/^dev_/, '');
            const m = k.match(/(?:class|notification)_([a-d]+)/); return !cls || !m || [...m[1]].some((x) => cls.includes(x)); }) : [];
      const checklist = canUse(t, 'requirements') ? await rows(db, `select id, name, applies, match, note from reg_checklist where country = $1 and scope = 'device' order by sort`, [market]) : null;
      const ready = checklist ? (await rows(db, 'select item from product_checklist where product_id = $1 and country = $2', [id, market])).map((r) => r.item as string) : [];
      const inGroupN = group ? await one(db, `select (select count(*)::int from devices where country = $1 and active and use_group = $2) as devices,
          (select count(*)::int from registrations where country = $1 and active and use_group = $2) as medicines`, [market, group]) : null;
      const importers = group && canUse(t, 'matching') ? (await rows(db, 'select total from group_partners($1, $2) limit 1', [market, group]))[0]?.total ?? 0 : null;
      return { ...base, routes: dRoutes, checklist, ready, inGroupN, importers };
    }
    if (!p.molecule_id) return base;
    if (!hasData(market)) return base;
    const origin = canUse(t, 'market') ? await rows(db, `select initcap(lower(coalesce(manufacturing_country, 'not stated'))) as country, count(*)::int as n
        from registrations where molecule_id = $1 and country = $2 and active group by 1 order by n desc limit 5`, [p.molecule_id, market]) : null;
    const lapsed = canUse(t, 'market') ? Number((await one(db, `select count(*)::int as n from registrations where molecule_id = $1 and country = $2 and not active`,
      [p.molecule_id, market]))?.n ?? 0) : null;
    const routeKey = (await one(db, 'select route_key from molecule_routes where molecule_id = $1', [p.molecule_id]))?.route_key
      ?? (p.who_pq || p.sra_approved ? 'abridged' : 'full');
    const route = canUse(t, 'pathway') ? await one(db, 'select label, description, months_low, months_high from registration_routes where key = $1', [routeKey]) : null;
    // this market's routes this product can use, fastest first (fast-track and priority need their own criteria)
    const allRoutes = canUse(t, 'pathway') ? await rows(db, `select key, label, description, months_low, months_high, fee_usd_low, fee_usd_high, eligibility
        from country_routes where country = $1 order by sort`, [market]) : [];
    const routes = allRoutes.filter((r) => r.eligibility !== 'sra_or_pq' || p.who_pq || p.sra_approved)
      .filter((r) => !/fast|priority/.test(r.key)).sort((a, b) => (a.months_low ?? 99) - (b.months_low ?? 99));
    // the documents this market asks for, the ones that apply to this product, and which the manufacturer has ready
    const checklist = canUse(t, 'requirements') ? (await rows(db, 'select id, name, applies, match, note from reg_checklist where country = $1 order by sort', [market]))
      .filter((c) => c.applies === 'all' || appliesTo({ ...c, topic: '', title: c.name, body: '' } as Requirement, { ...p, category: productClass(p) })) : null;
    const ready = checklist ? (await rows(db, 'select item from product_checklist where product_id = $1 and country = $2', [id, market])).map((r) => r.item as string) : [];
    // distributors strong in the class who do not carry this molecule yet (codes only; names stay with Nazryx)
    const open = canUse(t, 'matching') && p.category ? (await rows(db, 'select carries from partner_search($1, $2, $3)', [market, p.category, p.molecule_id]))
      .filter((x) => !x.carries).length : null;
    // public tenders for this molecule in this market
    const tenders = canUse(t, 'market') && p.molecule_id ? await rows(db, `select id, coalesce(title_en, title) as title, coalesce(buyer_en, buyer) as buyer, stage, coalesce(awarded, closing, published) as at, quantity,
        unit_price, value, currency, bidders, url from tenders where country = $2 and $1 = any(molecule_ids)
        order by coalesce(awarded, closing, published) desc nulls last limit 6`, [p.molecule_id, market]) : [];
    // the molecule's average price in this market: listings, or an estimate from a neighbouring market
    const price = canUse(t, 'market') ? await one(db, `${PRICE_SQL} where molecule_id = $1 and country = $2`, [p.molecule_id, market]) as MoleculePrice | null : null;
    const avg = price && priceFits(price, p.dosage_form) ? price : null;     // a vial price says nothing about a capsule
    // nothing priced here or near: the price where it sells elsewhere, converted at today's rate, as a reference only
    let ref: { price: number; per: string; currency: string } | null = null;
    if (!avg && canUse(t, 'market')) {
      const fx = Object.fromEntries((await rows(db, 'select currency, per_usd::float as r from fx_rates')).map((x) => [x.currency, x.r]));
      const cur = (await one(db, 'select currency from countries where code = $1', [market]))?.currency;
      // the nearest other market that prices it (CIS first), not an average with Europe's originator prices
      const order = ['KZ', 'UZ', 'KG', 'NG', 'KE', 'TZ'];
      const vals = (await rows(db, `${PRICE_SQL} where molecule_id = $1 and country <> $2`, [p.molecule_id, market]) as MoleculePrice[])
        .filter((x) => priceFits(x, p.dosage_form) && fx[x.currency] && cur && fx[cur])
        .sort((a, b) => (order.indexOf(a.country) + 99) % 99 - (order.indexOf(b.country) + 99) % 99)
        .map((x) => ({ v: Number(x.generic_price ?? x.unit_price) * packOf(x) / fx[x.currency] * fx[cur], per: unitWord(x) }));
      if (vals.length && cur) ref = { price: vals[0].v, per: vals[0].per, currency: cur };
    }
    // a market with only one or two products prices the brand; a generic usually enters lower (measured on lists that say which is which)
    const costs = avg ? await one(db, 'select freight, duty, distributor, pharmacy, vat from market_costs where country = $1', [market]) : null;
    const brands = avg ? await one(db, `select (select registrants from country_molecules where molecule_id = $1 and country = $2) as registrants,
        (select value from price_factors where key = 'generic_vs_originator') as generic`, [p.molecule_id, market]) : null;
    return { ...base, origin, lapsed, route, routes, checklist, ready, open, tenders, brands, costs, ...(canUse(t, 'market') ? { avg, ref } : {}) };
  });
  if (!d) notFound();
  const { p, market } = d;
  const be = p.be_study ? null : beSuggestion(p.forms ?? p.dosage_form);
  const g = productGroup(p);
  const cls = displayClass(p);   // an eye lubricant is not 'pain' because it shares hyaluronate with joint injections
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
          {d.comp && <Competitors c={{ ...d.comp, kind: d.kind }} id={id} market={market} u={u} open={canUse(d.t, 'market')} />}
          {d.kind === 'device' ? (hasData(market) ? (<>
            <section className="card stack" data-tour="product">
              <div className="card-h"><h2>Medical device in {countryName(market)}</h2><span className="pill blue">{g ? GROUP_LABEL[g] : 'Medical device'}</span></div>
              {'inGroupN' in d && d.inGroupN ? (
                <p>{d.inGroupN.devices + d.inGroupN.medicines > 0
                  ? <><b className="num">{d.inGroupN.devices}</b> registered as devices and <b className="num">{d.inGroupN.medicines}</b> as medicines in this group in {countryName(market)}. Brands and prices are below.</>
                  : <>Nothing in this group is registered in {countryName(market)} yet: an opening.</>}</p>) : null}
              <p className="small muted">Registered with {market === 'KE' ? 'the Pharmacy and Poisons Board' : market === 'TZ' ? 'TMDA' : market === 'NG' ? 'NAFDAC' : 'the regulator'} as a medical device, under device rules (risk class, conformity evidence, a local representative).
</p>
              <form action={setKind} className="small"><input type="hidden" name="product_id" value={id} /><input type="hidden" name="market" value={market} /><input type="hidden" name="kind" value="medicine" />
                Not a device? <button className="btn-link" type="submit">Treat it as a medicine</button></form>
            </section>
            <section className="card stack">
              <h2>Distributors who import {g ? GROUP_LABEL[g].toLowerCase() : 'devices like it'}</h2>
              {'importers' in d && d.importers != null ? (<>
                <p><b className="num">{d.importers}</b> distributors in {countryName(market)} already import products in this group (devices and medicines together).</p>
                {g && <Link className="btn btn-ghost btn-sm" href={`/m/partners?market=${market}&group=${g}`} style={{ alignSelf: 'flex-start' }}>See them</Link>}</>)
                : <PlanLock need="access" title="Distributors who import products like yours" u={u} market={market}>The local representatives and importers already registering devices in this group, ready for an introduction.</PlanLock>}
            </section>
            <section className="card stack">
              <h2>Time and cost to register a device</h2>
              {g && DEVICE_CLASS[g] && <p className="small muted">Products like this are usually Class {DEVICE_CLASS[g].toUpperCase().split('').join(' or ')}; we confirm the class when we review your file.</p>}
              {'routes' in d && d.routes.length > 0 ? (<>
                {d.routes.map((r: any, i: number) => <p key={r.key} className={i ? 'small' : ''}><b>{r.label}</b>{r.months_low != null ? <>: about <b>{r.months_low}–{r.months_high} months</b></> : null}
                  {r.fee_usd_low != null ? <>, official fees <b>${Number(r.fee_usd_low).toLocaleString('en')}{r.fee_usd_high && r.fee_usd_high !== r.fee_usd_low ? `–${Number(r.fee_usd_high).toLocaleString('en')}` : ''}</b></> : null}.
                  {r.description && <span className="muted"> {r.description}</span>}</p>)}
                {!(p.who_pq || p.sra_approved) && <p className="small muted">CE-marked or FDA-cleared? Tick &ldquo;Approved by a strict regulator&rdquo; below and reliance routes open up.</p>}
              </>) : canUse(d.t, 'pathway') ? <p className="small muted">Device routes for {countryName(market)} are being checked by our team.</p>
                : <PlanLock need="access" title="Device route, timeline and fees" u={u} market={market}>How this device registers in {countryName(market)}, how long it takes and the official fees.</PlanLock>}
            </section></>) : <AgencyMarket code={market} />)
          : !p.molecule_id ? (
            <section className="card stack"><h2>Not matched yet</h2>
              <p className="muted">Our team is matching &ldquo;{p.name}&rdquo; to the market. You can still ask for any service in the meantime.</p>
              <form action={setKind}><input type="hidden" name="product_id" value={id} /><input type="hidden" name="market" value={market} /><input type="hidden" name="kind" value="device" />
                <button className="btn btn-ghost btn-sm" type="submit">It is a medical device</button></form></section>
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
              <h2>Time and cost to register</h2>
              {'routes' in d && d.routes.length > 0 ? (<>
                <p><b>{d.routes[0].label}</b>: about <b>{d.routes[0].months_low}–{d.routes[0].months_high} months</b>
                  {d.routes[0].fee_usd_low != null ? <>, official fees <b>${Number(d.routes[0].fee_usd_low).toLocaleString('en')}{d.routes[0].fee_usd_high && d.routes[0].fee_usd_high !== d.routes[0].fee_usd_low ? `–${Number(d.routes[0].fee_usd_high).toLocaleString('en')}` : ''}</b></> : null}.
                  <span className="muted"> {d.routes[0].description}</span></p>
                {d.routes.length > 1 && <p className="small muted">Also open to you: {d.routes.slice(1).map((r) => `${r.label} (${r.months_low}–${r.months_high} months)`).join(', ')}.</p>}
                {!(p.who_pq || p.sra_approved) && <p className="small muted">Approved by a strict regulator or WHO-prequalified? Tick it below and faster routes open up.</p>}
              </>) : 'route' in d && d.route ? <p><b>{d.route.label}</b>{d.route.months_low != null ? `: about ${d.route.months_low}–${d.route.months_high ?? d.route.months_low} months` : ''}. <span className="muted">{d.route.description}</span></p>
                : <PlanLock need="access" title="Route and timeline" u={u} market={market}>The registration route for this product, what it needs and how long it takes.</PlanLock>}
              <p className="muted">{p.be_study ? 'You have a bioequivalence study.' : be ? `${BE_STATUS[be]}.` : 'Whether a bioequivalence study is needed: we confirm it when we check your dossier.'}</p>
            </section>
          </>)}
          {'checklist' in d && d.checklist && d.checklist.length > 0 && (
            <section className="card stack" id="documents">
              <div className="card-h"><div><h2>Documents for {countryName(market)}</h2>
                <p className="note">What {countryName(market)} asks for with this product. Tick what you have ready.</p></div>
                <span className="pill mint">{d.ready.filter((x) => d.checklist!.some((c) => c.name === x)).length} of {d.checklist.length} ready</span></div>
              <div className="stack" style={{ gap: 4 }}>{d.checklist.map((c) => {
                const done = d.ready.includes(c.name);
                return (
                  <form key={c.id} action={toggleChecklist} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} />
                    <input type="hidden" name="item" value={c.name} /><input type="hidden" name="done" value={done ? '0' : '1'} />
                    <button type="submit" aria-label={done ? 'Mark as not ready' : 'Mark as ready'}
                      style={{ flex: '0 0 20px', width: 20, height: 20, marginTop: 1, borderRadius: 6, cursor: 'pointer', padding: 0, lineHeight: '18px',
                        fontSize: 13, color: '#fff', border: `1.5px solid ${done ? 'var(--blue)' : 'var(--line)'}`, background: done ? 'var(--blue)' : '#fff' }}>{done ? '✓' : ''}</button>
                    <span className="small" style={{ textDecoration: done ? 'line-through' : undefined, opacity: done ? 0.6 : 1 }}>{c.name}
                      {c.note && <span className="muted"> · {c.note}</span>}</span>
                  </form>);
              })}</div>
            </section>)}
          {'avg' in d && (d.avg ? (
            <section className="card stack">
              <div className="card-h"><h2>Price in {countryName(market)}</h2>
                <span className="pill peach">Est. avg</span></div>
              {/* low, average and high; one average when they are all the same price */}
              {(() => {
                const p = d.avg!, k = packOf(p), avg = Number(p.generic_price ?? p.unit_price) * k;
                const lo = p.lo != null ? Math.min(Number(p.lo) * k, avg) : null, hi = p.hi != null ? Math.max(Number(p.hi) * k, avg) : null;
                const same = (x: number | null) => x == null || Math.round(x) === Math.round(avg);
                const tiles: [string, number, string][] = same(lo) && same(hi) ? [['Average', avg, 't-blue']]
                  : [['Low', lo ?? avg, 't-mint'], ['Average', avg, 't-blue'], ['High', hi ?? avg, 't-lav']];
                return <div className={`grid ${tiles.length === 1 ? '' : 'g3'}`}>{tiles.map(([label, v, tone]) => (
                  <div key={label} className={`tile ${tone}`}><span className="k">{label}</span>
                    <span className="v num" style={{ fontSize: 22 }}>{p.currency} {fmtMoney(v)}</span>
                    <span className="small">per {unitWord(p)}{label === 'Average' ? ` · ${usd(v * Number(p.unit_usd) / Number(p.unit_price))}` : ''}</span></div>))}</div>;
              })()}
              <p className="small muted">{priceBasis(d.avg)}</p>
              {!d.avg.generic_price && d.brands?.registrants != null && Number(d.brands.registrants) <= 2 && Number(d.brands.generic) < 1 && (
                <p className="small"><span className="pill peach">Few products</span> Only {d.brands.registrants} {Number(d.brands.registrants) === 1 ? 'product is' : 'products are'} registered here, so these prices are mostly the brand&rsquo;s. A generic usually enters about {Math.round((1 - Number(d.brands.generic)) * 100)}% lower: around <b>{d.avg.currency} {fmtMoney(Number(d.avg.unit_price) * packOf(d.avg) * Number(d.brands.generic))}</b> per {unitWord(d.avg)}.</p>)}
              {d.avg.by_strength.length > 1 && (
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Strength</th><th className="r">Per {unitShort(d.avg)}</th><th className="r">Per pack</th><th className="r">Prices</th></tr></thead>
                  <tbody>{d.avg.by_strength.map((x) => <tr key={x.strength}><td>{x.strength}</td><td className="r num">{fmtMoney(x.unit)}</td><td className="r num">{fmtMoney(x.pack)}</td><td className="r num">{x.n}</td></tr>)}</tbody></table></div>)}
            </section>) : (
            <section className="card between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <span><b>Price in {countryName(market)}</b>
                {'ref' in d && d.ref ? <div className="small">Not sold near {countryName(market)}. Reference price in other markets: <b>{d.ref.currency} {fmtMoney(d.ref.price)}</b> per {d.ref.per},
                  converted at today&rsquo;s rate.<div className="muted">A reference only, not a local estimate. We check the local price for you within 24 hours.</div></div>
                  : <div className="small muted">No public price for this medicine yet. We check it for you within 24 hours.</div>}</span>
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
/** Retail to wholesale (what pharmacies pay) and to the distributor's buying price, with the market's VAT and margins. */
function trade(retail: number, c: any) {
  const exVat = retail / (1 + Number(c?.vat ?? 0));
  const wholesale = exVat / (1 + Number(c?.pharmacy ?? 0.35));
  return { wholesale, buying: wholesale / (1 + Number(c?.distributor ?? 0.25)) };
}
const DEVICE_CLASS: Record<string, string> = { eye_drops: 'b', nasal: 'ab', eye_surgery: 'c', joint: 'cd', contact_lens: 'bc', dermal_filler: 'd', inhaled_saline: 'ab' };
const amt = (cur: string, v: number) => `${cur} ${Math.round(v).toLocaleString('en')}`;
/** Made in the market, or imported (and from where); nothing when the register does not say. */
function Origin({ made, market }: { made: string | null; market: string }) {
  if (!made) return <span className="muted">—</span>;
  const home = countryName(market).toLowerCase();
  const local = made.toLowerCase().split(/,\s*/).some((c) => c === home);
  return <><span className={`pill ${local ? 'mint' : ''}`} style={{ fontSize: 12 }}>{local ? 'Made locally' : 'Imported'}</span>
    {!local && <div className="sub2">{made}</div>}</>;
}

function Competitors({ c, id, market, u, open }: { c: { group: string | null; kind: string; brands: BrandRow[]; others: any[]; costs: any }; id: number; market: string; u: any; open: boolean }) {
  const range = (ps: number[], cur: string) => ps.length ? (Math.min(...ps) === Math.max(...ps) ? amt(cur, ps[0]) : `${amt(cur, Math.min(...ps))}–${Math.round(Math.max(...ps)).toLocaleString('en')}`) : '—';
  return (
    <section className="card stack" id="competitors">
      <div className="card-h"><div><h2>Competitor brands in {countryName(market)}</h2>
        <p className="note">Registered as a medicine or a medical device, and what they sell for in pharmacies. Wholesale and distributor prices are worked back from the shelf price with this market&rsquo;s margins.</p></div></div>
      <form action={setUseGroup} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="hidden" name="product_id" value={id} /><input type="hidden" name="market" value={market} />
        <span className="small">Compare with</span>
        <select className="input" name="use_group" defaultValue={c.group ?? ''} style={{ width: 'auto' }} aria-label="What the product is used for">
          <option value="">Same medicine</option>{Object.entries(GROUP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="small">registered as</span>
        <select className="input" name="kind" defaultValue={c.kind} style={{ width: 'auto' }} aria-label="Registered as">
          <option value="medicine">a medicine</option><option value="device">a medical device</option></select>
        <button className="btn btn-ghost btn-sm" type="submit">Save</button>
      </form>
      {c.brands.length > 0 && (open ? (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Brand</th><th>Registered</th><th>Made</th><th className="r">Shelf price</th><th className="r">Wholesale (est.)</th><th className="r">Distributor buys at (est.)</th><th /></tr></thead>
          <tbody>{c.brands.map((b) => {
            const cur = b.prices[0]?.currency ?? '';
            const ps = b.prices.map((x) => x.price);
            const mid = ps.length ? ps.sort((x, y) => x - y)[Math.floor(ps.length / 2)] : null;
            const t = mid != null ? trade(mid, c.costs) : null;
            return (
              <tr key={b.id}>
                <td><b>{b.brand}</b>{b.prices.length > 0 && <div className="sub2">{b.prices.slice(0, 3).map((x) => x.name).join(' · ')}</div>}</td>
                <td className="small">{b.medicine || b.device ? <span className="pill mint">{b.device ? `Device${b.deviceClass ? `, ${b.deviceClass}` : ''}` : 'Medicine'}</span> : <span className="pill">Not on the register</span>}
                  {b.since ? <div className="sub2">since {b.since}</div> : null}</td>
                <td className="small"><Origin made={b.origin} market={market} /></td>
                <td className="r num">{range(ps, cur)}{b.per10 != null && <div className="sub2">≈ {amt(cur, b.per10)} per 10 ml</div>}</td>
                <td className="r num">{t ? amt(cur, t.wholesale) : '—'}</td>
                <td className="r num">{t ? amt(cur, t.buying) : '—'}</td>
                <td className="r"><form action={removeCompetitor}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="product_id" value={id} /><input type="hidden" name="market" value={market} />
                  <button className="btn btn-ghost btn-sm" type="submit" aria-label={`Remove ${b.brand}`}>✕</button></form></td>
              </tr>);
          })}</tbody></table></div>)
        : (<>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{c.brands.map((b) => <span key={b.id} className="pill">{b.brand}</span>)}</div>
          <PlanLock need="data" title="Where your competitor brands are registered and what they sell for" u={u} market={market} /></>))}
      <form action={addCompetitors} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="hidden" name="product_id" value={id} /><input type="hidden" name="market" value={market} />
        <input className="input" name="brands" placeholder="Brands you compete with, comma separated (e.g. Systane, Hylo-Comod)" style={{ flex: '1 1 260px' }} aria-label="Competitor brands" required />
        <button className="btn btn-blue btn-sm" type="submit">Add</button>
      </form>
      {c.group && open && (c.others.length > 0 ? (<>
        <h3>Also in {countryName(market)}: {GROUP_LABEL[c.group].toLowerCase()}</h3>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Brand</th><th>Registered</th><th>Made</th><th className="r">Shelf price</th><th className="r">Wholesale (est.)</th></tr></thead>
          <tbody>{c.others.map((o) => {
            const mid = o.prices.length ? [...o.prices].sort((x: number, y: number) => x - y)[Math.floor(o.prices.length / 2)] : null;
            return (
              <tr key={o.brand}><td><b>{o.brand}</b>{o.packs.length > 0 && <div className="sub2">{o.packs.join(' · ')}</div>}</td>
                <td className="small">{o.registered ? <span className="pill mint">{o.registered}</span> : <span className="pill">Not on the register</span>}</td>
                <td className="small"><Origin made={o.made} market={market} /></td>
                <td className="r num">{range(o.prices, o.currency)}{o.per10 != null && <div className="sub2">≈ {amt(o.currency, o.per10)} per 10 ml</div>}</td>
                <td className="r num">{mid != null ? amt(o.currency, trade(mid, c.costs).wholesale) : '—'}</td></tr>);
          })}</tbody></table></div></>)
        : <p className="small muted">No other {GROUP_LABEL[c.group].toLowerCase()} found in {countryName(market)}&rsquo;s registers or pharmacy listings yet.</p>)}
      <p className="note">Prices are pharmacy shelf prices found online, per pack, with a per-10 ml figure so bottle sizes compare fairly. Hospital products such as viscoelastics and joint injections are rarely sold in pharmacies; ask us and we check them for you.</p>
    </section>);
}

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
