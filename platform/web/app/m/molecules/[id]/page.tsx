import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { ConfidenceChip, Empty, Flash, PlanLock } from '@/components/ui';
import PriceHistory from '@/components/PriceHistory';
import { addMfrProduct, unwatchMolecule, watchMolecule } from '@/app/actions/mfr';
import { addToPipeline } from '@/app/actions/finder';
import Comments, { loadComments } from '@/components/Comments';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate, fmtMoney, levelLabel } from '@/lib/format';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { PRICE_SQL, packOf, priceBasis, unitShort, usd, type MoleculePrice } from '@/lib/prices';

export const metadata = { title: 'Molecule' };

// One molecule in one market: who sells it, at what price, who buys it in tenders, who could distribute it, how to register it.
export default async function MoleculePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ market?: string; saved?: string; error?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const mol = await one(db, 'select id, inn, category, dosage_form from molecules where id = $1', [id]);
    if (!mol) return null;
    const t = tierIn(u, market), open = canUse(t, 'market'), lists = canUse(t, 'distributors');
    const mine = await rows(db, 'select id, name from mfr_products where user_id = $1 and molecule_id = $2 order by name', [u.id, id]);
    const watched = Boolean(await one(db, 'select 1 as x from watches where user_id = $1 and molecule_id = $2', [u.id, id]));
    // the same molecule across every market they target: where it is open, where it is crowded
    const across = await rows(db, `select cm.country, cm.registrants, cm.registrations, cm.on_national_list, g.demand from country_molecules cm
        left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country where cm.molecule_id = $1 and cm.country = any($2) order by cm.country`, [id, targets]);
    const base = { targets, market, mol, t, open, lists, mine, watched, across, f: null as any, regs: [] as any[], origins: [] as any[], price: null as MoleculePrice | null,
      history: [] as any[], tenders: [] as any[], partners: [] as any[], names: {} as Record<string, string>, inPipe: new Set<string>(), routes: [] as any[], comments: [] as any[], seats: [] as any[] };
    if (!hasData(market)) return base;
    const f = await one(db, `select cm.*, g.demand, g.score from country_molecules cm left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country
        where cm.molecule_id = $1 and cm.country = $2`, [id, market]);
    const regs = open ? await rows(db, 'select * from molecule_registrations($1, $2)', [id, market]) : [];
    const origins = open ? await rows(db, `select initcap(lower(coalesce(manufacturing_country, 'not stated'))) as country, count(*)::int as n from registrations
        where molecule_id = $1 and country = $2 and active group by 1 order by n desc limit 6`, [id, market]) : [];
    const price = open ? await one(db, `${PRICE_SQL} where molecule_id = $1 and country = $2`, [id, market]) as MoleculePrice | null : null;
    const history = price ? await rows(db, `select day, unit_price::float as unit_price, confidence from price_history where molecule_id = $1 and country = $2 and unit = $3 order by day`, [id, market, price.unit]) : [];
    const tenders = open ? await rows(db, `select id, coalesce(title_en, title) as title, coalesce(buyer_en, buyer) as buyer, stage, coalesce(awarded, closing, published) as at, quantity, unit_price, value, currency, bidders
        from tenders where country = $2 and $1 = any(molecule_ids) order by coalesce(awarded, closing, published) desc nulls last limit 8`, [id, market]) : [];
    // distributors in the market: those who carry it and those strong in its class who do not
    const partners = await rows(db, 'select * from partner_search($1, $2, $3, false, 0, $4)', [market, mol.category, id, 'open']);
    const names = lists || u.role === 'team' ? Object.fromEntries((await rows(db, 'select code, name from partner_names($1)', [market])).map((r) => [r.code, r.name])) : {};
    const inPipe = new Set((await rows(db, 'select code from my_pipeline($1)', [market])).map((r) => r.code));
    const routes = canUse(t, 'pathway') ? await rows(db, `select label, months_low, months_high, fee_usd_low, fee_usd_high from country_routes where country = $1 and scope = 'medicine' order by sort limit 3`, [market]) : [];
    const comments = await loadComments(db, 'molecule', String(id));
    const seats = await rows(db, 'select id, name, email from users where id = $1 or owner_id = $1', [u.owner_id ?? u.id]);
    return { ...base, f, regs, origins, price, history, tenders, partners, names, inPipe, routes, comments, seats };
  });
  if (!d) notFound();
  const { mol, market: m } = d, name = countryName(m);
  const here = `/m/molecules/${id}?market=${m}`;
  const f = d.f;
  const carriers = d.partners.filter((p) => p.carries), openTo = d.partners.filter((p) => !p.carries);
  const n = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('en');
  const Partner = ({ p }: { p: any }) => (
    <div className="between" style={{ alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ minWidth: 0 }}>
        <Link href={`/m/partners?market=${m}&molecule=${id}`}><span className="nm">{d.names[p.code] || `Distributor ${p.code}`}</span></Link>
        <div className="sub2">{p.products} products · {p.molecules} molecules{p.top_classes ? ` · strongest in ${p.top_classes}` : ''}{p.local_maker ? ' · local maker' : ''}</div>
      </div>
      {d.inPipe.has(p.code) ? <Link className="pill mint" href={`/m/partners?market=${m}&tab=pipeline`}>{t('In your pipeline')}</Link>
        : <form action={addToPipeline}><input type="hidden" name="market" value={m} /><input type="hidden" name="code" value={p.code} /><input type="hidden" name="return" value={here} />
          <button className="btn btn-ghost btn-sm" type="submit">{t('Shortlist')}</button></form>}
    </div>);
  return (
    <Shell user={u} title={mol.inn} sub={[mol.category, f?.forms].filter(Boolean).join(' · ') || 'Molecule'}
      crumb={<><Link href={`/m/finder?market=${m}`}>{t('Opportunities')}</Link> / {mol.inn}</>}
      actions={<>
        {d.mine.length > 0 ? <Link className="btn btn-ghost btn-sm" href={`/m/products/${d.mine[0].id}?market=${m}`}>{t('Your product')}</Link>
          : <form action={addMfrProduct}><input type="hidden" name="name" value={mol.inn} /><input type="hidden" name="return" value={here} />
              <button className="btn btn-ghost btn-sm" type="submit">{t('Add to my products')}</button></form>}
        <form action={d.watched ? unwatchMolecule : watchMolecule}><input type="hidden" name="molecule_id" value={id} /><input type="hidden" name="return" value={here} />
          <button className="btn btn-blue btn-sm" type="submit">{d.watched ? t('Watching · stop') : t('Watch')}</button></form>
      </>}>
      <Flash sp={sp} />
      <MarketPicker u={u} targets={d.targets} current={m} path={`/m/molecules/${id}`} />
      {!hasData(m) || !f ? <AgencyMarket code={m} /> : (<>
        <div className="grid g4">
          <div className={`tile ${f.registrants === 0 ? 't-peach' : 't-blue'}`}><span className="k">{t('Companies selling it')}</span><span className="v num">{f.registrants}</span>
            <span className="small">{f.registrants === 0 ? 'nobody registered: open' : `${n(f.registrations)} registered products`}</span></div>
          <div className="tile t-lav"><span className="k">{t('Essential list')}</span><span className="v" style={{ fontSize: 20, lineHeight: 1.2 }}>{f.on_national_list ? 'Listed' : 'Not listed'}</span>
            <span className="small">{f.on_national_list ? levelLabel(f.facility_level) : f.on_who_eml ? 'on the WHO list' : 'neither national nor WHO list'}</span></div>
          <div className="tile t-mint"><span className="k">{t('Demand')}</span><span className="v num">{f.demand != null ? Number(f.demand).toFixed(2) : '—'}</span>
            <span className="small">{f.demand != null ? 'of 1, from lists, levels and tenders' : 'not scored'}</span></div>
          <div className="tile t-white"><span className="k">{t('Made locally')}</span><span className="v num">{f.local_made ?? 0}</span><span className="small">{f.in_combinations ? `${f.in_combinations} in combinations` : 'products made in ' + name}</span></div>
        </div>
        <div className="split">
          <div className="stack">
            <section className="card stack">
              <div className="card-h"><div><h2>Shelf price in {name}</h2>{d.price && <p className="note">{priceBasis(d.price)}</p>}</div>{d.price && <ConfidenceChip level={d.price.confidence} />}</div>
              {!d.open ? <PlanLock need="data" title={`The price of ${mol.inn} in ${name}`} u={u} market={m}>{t('The median shelf price per unit, where it comes from, and how it moved.')}</PlanLock>
                : !d.price ? <Empty>No shelf price read for {mol.inn} in {name} yet. <Link href={`/m/coverage?market=${m}`}>{t('What we have read')}</Link>.</Empty> : (<>
                  <p><b className="num" style={{ fontSize: 22 }}>{d.price.currency} {fmtMoney(Number(d.price.unit_price) * packOf(d.price))}</b> per {unitShort(d.price)}
                    {d.price.unit_usd != null && <span className="muted"> · {usd(Number(d.price.unit_usd) * packOf(d.price))}</span>}
                    {d.price.strength && <span className="muted"> · {d.price.strength}</span>}</p>
                  {d.history.length > 1 && <PriceHistory rows={d.history} currency={d.price.currency} unit={unitShort(d.price)} pack={packOf(d.price)} />}
                </>)}
            </section>
            <section className="card stack">
              <div className="card-h"><div><h2>{t('Registered products')}</h2><p className="note">{d.open ? `${n(f.registrations)} active${d.regs.some((r) => r.lapsed) ? `, ${d.regs.filter((r) => r.lapsed).length} lapsed kept` : ''}. Holders are named on Complete Market Access.` : 'Every brand, strength and holder.'}</p></div></div>
              {!d.open ? <PlanLock need="data" title={`Every ${mol.inn} registered in ${name}`} u={u} market={m}>{t('Brand, strength, form, year, where it is made and who holds it.')}</PlanLock>
                : d.regs.length === 0 ? <Empty>{t('Nothing registered: whoever files first is alone on the shelf.')}</Empty> : (<>
                  {d.origins.length > 0 && <p className="small muted">Made in {d.origins.map((o) => `${o.country} (${o.n})`).join(', ')}.</p>}
                  <div className="tbl-wrap"><table className="tbl">
                    <thead><tr><th>{t('Brand')}</th><th className="hide-m">{t('Strength')}</th><th className="hide-m">{t('Form')}</th><th>{t('Holder')}</th><th className="r">{t('Year')}</th></tr></thead>
                    <tbody>{d.regs.map((r) => (
                      <tr key={r.id} style={r.lapsed ? { opacity: 0.55 } : undefined}>
                        <td><b>{r.brand || mol.inn}</b>{r.lapsed && <span className="pill" style={{ marginLeft: 6, fontSize: 11 }}>{t('lapsed')}</span>}{r.made_in && <div className="sub2">made in {r.made_in}</div>}</td>
                        <td className="hide-m small">{r.strength ?? ''}</td><td className="hide-m small">{r.form ?? ''}</td>
                        <td className="small">{r.holder ?? (r.holder_code ? <Link href={`/m/partners?market=${m}&molecule=${id}`}>{r.holder_code}</Link> : '')}</td>
                        <td className="r small num">{r.reg_year ?? ''}</td>
                      </tr>))}</tbody></table></div>
                </>)}
            </section>
            <section className="card stack">
              <div className="card-h"><h2>Public tenders for {mol.inn}</h2><Link className="btn-link" href={`/m/tenders?market=${m}`}>{t('All tenders')}</Link></div>
              {!d.open ? <PlanLock need="data" title={t('Who buys it in tenders')} u={u} market={m}>{t('Quantities, awarded prices and bidders from the public buyers.')}</PlanLock>
                : d.tenders.length === 0 ? <Empty>No public tender names {mol.inn} in {name} in what we have collected.</Empty>
                : d.tenders.map((x, i) => (
                  <Link key={x.id} href={`/m/tenders/${x.id}`} className="between small" style={{ borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 8 : 0, gap: 12, flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                    <span style={{ minWidth: 0, flex: '1 1 240px' }}><b>{x.title}</b><div className="sub2">{x.buyer ?? t('Public buyer')} · {x.stage}{x.at ? ` · ${fmtDate(x.at)}` : ''}</div></span>
                    <span className="num">{x.unit_price != null ? `${x.currency ?? ''} ${fmtMoney(x.unit_price)} per unit` : x.value != null ? `${x.currency ?? ''} ${fmtMoney(x.value)}` : ''}{x.quantity ? <div className="sub2">{n(x.quantity)} units</div> : null}</span>
                  </Link>))}
            </section>
          </div>
          <div className="stack">
            <section className="card stack">
              <h2>{t('Across your markets')}</h2>
              {d.across.length === 0 ? <p className="note">{t('Not registered or listed in any of your markets.')}</p> : d.across.map((a) => (
                <Link key={a.country} href={`/m/molecules/${id}?market=${a.country}`} className="between small" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span><b>{countryName(a.country)}</b>{a.on_national_list ? <span className="sub2"> {t('· essential')}</span> : null}</span>
                  <span>{a.registrants === 0 ? <span className="pill peach">{t('Open')}</span> : <span className="pill">{a.registrants} {a.registrants === 1 ? 'company' : 'companies'}</span>}</span>
                </Link>))}
            </section>
            <section className="card stack">
              <div className="card-h"><h2>{t('Distributors')}</h2><Link className="btn-link" href={`/m/partners?market=${m}&molecule=${id}`}>{t('All')}</Link></div>
              {!d.lists ? (<>
                <p className="small"><b className="num">{carriers.length}</b> {carriers.length === 1 ? 'distributor carries' : 'distributors carry'} {mol.inn} in {name}; <b className="num">{openTo.length}</b> strong in {mol.category ? 'its class' : 'the market'} do not yet.</p>
                <PlanLock need="access" title={t('Who they are')} u={u} market={m}>{t('Names and profiles, who carries it and who could, ready to shortlist.')}</PlanLock></>) : (<>
                {openTo.length > 0 && <div><span className="lbl">Could take it on ({openTo.length})</span>{openTo.slice(0, 5).map((p) => <Partner key={p.code} p={p} />)}</div>}
                {carriers.length > 0 && <div><span className="lbl">Already carry it ({carriers.length})</span>{carriers.slice(0, 5).map((p) => <Partner key={p.code} p={p} />)}</div>}
                {d.partners.length === 0 && <p className="note">No distributor profile in {name} yet.</p>}
              </>)}
            </section>
            <section className="card stack">
              <h2>Registering it in {name}</h2>
              {d.routes.length > 0 ? d.routes.map((r) => (
                <p key={r.label} className="small"><b>{r.label}</b>: {r.months_low}–{r.months_high} months{r.fee_usd_low != null ? `, fees $${Number(r.fee_usd_low).toLocaleString('en')}${r.fee_usd_high && r.fee_usd_high !== r.fee_usd_low ? `–${Number(r.fee_usd_high).toLocaleString('en')}` : ''}` : ''}.</p>))
                : <PlanLock compact need="access" title={t('Routes, time and fees')} u={u} market={m} />}
              <Link className="btn-link small" href={`/m/regulatory?market=${m}`}>Requirements in {name}</Link>
            </section>
            <Comments kind="molecule" target={String(id)} list={d.comments} here={here} me={u.id} seats={d.seats} canWrite={u.seat_role !== 'viewer'} />
          </div>
        </div>
      </>)}
    </Shell>
  );
}
