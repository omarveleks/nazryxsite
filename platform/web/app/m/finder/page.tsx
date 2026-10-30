import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { ConfidenceChip, Empty, Flash, PlanLock } from '@/components/ui';
import { deleteSearch, saveSearch } from '@/app/actions/finder';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { categories } from '@/lib/queries';
import { ago } from '@/lib/format';
import { canUse, countryName, tierIn, demandLabel, demandTone } from '@/lib/mfr';
import { usd } from '@/lib/prices';
import { COMPETITION_STEPS, DEMAND_STEPS, FORM_STEPS, describeSearch, finderParams, finderQuery } from '@/lib/finder';

export const metadata = { title: 'Opportunities' };
const FREE_ROWS = 5;

// Every molecule in a market, filtered by what decides a registration: demand, how many sell it, the essential list, the
// form, the price. Save a search and the inbox tells you when a new molecule matches it.
export default async function Finder({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const p = finderParams(sp);
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    if (!hasData(market)) return { targets, market, list: [], cats: [], saved: [], total: 0 };
    const list = await rows(db, 'select * from find_opportunities($1, $2, $3, $4, $5, $6, $7, false, $8)', [market, p.category, p.demand, p.max, p.essential, p.form, p.price, p.mine]);
    const total = Number((await one(db, 'select count(*)::int as n from country_molecules where country = $1 and rankable', [market]))?.n ?? 0);
    const saved = await rows(db, 'select id, name, country, params, created_at, checked_at, cardinality(seen_ids) as n from saved_searches where user_id = $1 order by created_at desc', [u.id]);
    return { targets, market, list, cats: await categories(db, market), saved, total };
  });
  const m = d.market, tier = tierIn(u, m), full = canUse(tier, 'portfolio');
  const shown = full ? d.list : d.list.slice(0, FREE_ROWS);
  const filtered = Boolean(p.category || p.demand != null || p.max != null || p.essential || p.form || p.price != null || p.mine);
  const q = finderQuery(m, p);
  return (
    <Shell user={u} help={t('Use the filters to narrow the molecules, then sort by fit. Fit mixes demand (official list, tenders) with how many already sell it. Save a search and we run it every hour: a new match lands in your inbox.')} title={t('Opportunities')} sub={t('Which molecules to register next in {market}', { market: t(countryName(m)) })}
      actions={full && hasData(m) ? <a className="btn btn-ghost btn-sm" href={`/m/export?what=finder&${q}`}>{t('Excel (CSV)')}</a> : undefined}>
      <Flash sp={sp} />
      <MarketPicker u={u} targets={d.targets} current={m} path="/m/finder" />
      {!hasData(m) ? <AgencyMarket code={m} /> : (<>
        <form method="get" className="card tight stack" style={{ gap: 10 }} aria-label={t('Filters')}>
          <input type="hidden" name="market" value={m} />
          <div className="row">
            <select className="input" name="category" defaultValue={p.category ?? ''} aria-label={t('Therapeutic class')} style={{ flex: '2 1 220px' }}>
              <option value="">{t('All therapeutic classes')}</option>{d.cats.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select>
            <select className="input" name="max" defaultValue={p.max == null ? '' : String(p.max)} aria-label={t('Competition')} style={{ flex: '1 1 180px' }}>
              {COMPETITION_STEPS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
            <select className="input" name="demand" defaultValue={p.demand == null ? '' : String(p.demand)} aria-label={t('Demand')} style={{ flex: '1 1 180px' }}>
              {DEMAND_STEPS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
            <select className="input" name="form" defaultValue={p.form ?? ''} aria-label={t('Dosage form')} style={{ flex: '1 1 160px' }}>
              <option value="">{t('Any form')}</option>{FORM_STEPS.map((f) => <option key={f} value={f}>{t(`${f}s`)}</option>)}</select>
            <input className="input" name="price" type="number" min={0} step="0.01" defaultValue={p.price ?? ''} placeholder={t('Min price, $ per unit')} aria-label={t('Minimum price in dollars per unit')} style={{ flex: '1 1 160px' }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="essential" value="1" defaultChecked={p.essential} /> {t('On the essential list')}</label>
              <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="mine" value="1" defaultChecked={p.mine} /> {t('Not in my catalogue yet')}</label>
            </div>
            <div className="row">{filtered && <Link className="btn btn-ghost btn-sm" href={`/m/finder?market=${m}`}>{t('Clear')}</Link>}
              <button className="btn btn-blue btn-sm" type="submit">{t('Find')}</button></div>
          </div>
        </form>
        <div className="split">
          <section className="card stack">
            <div className="card-h"><div><h2>{filtered ? t('{n} of {total} molecules match', { n: d.list.length === 500 ? '500+' : d.list.length, total: d.total }) : t('{n} of {total} molecules registered or listed in {market}', { n: d.list.length === 500 ? '500+' : d.list.length, total: d.total, market: t(countryName(m)) })}</h2>
              <p className="note">{t('Best fit first: demand against how many already sell it. Open a molecule for its products, prices, tenders and distributors.')}</p></div>
              {full && filtered && (
                <form action={saveSearch} className="row" style={{ gap: 6 }}>
                  <input type="hidden" name="market" value={m} />
                  {Object.entries(Object.fromEntries(new URLSearchParams(q))).filter(([k]) => k !== 'market').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                  <input className="input" name="name" placeholder={t('Name this search')} aria-label={t('Search name')} maxLength={80} style={{ minHeight: 34, fontSize: 13, width: 170 }} />
                  <button className="btn btn-ghost btn-sm" type="submit">{t('Save and alert me')}</button>
                </form>)}
            </div>
            {shown.length === 0 ? <Empty>{t('Nothing matches. Loosen a filter.')}</Empty> : (
              <div className="tbl-wrap" tabIndex={0}><table className="tbl">
                <thead><tr><th>{t('Molecule')}</th><th className="r">{t('Companies')}</th><th className="hide-m">{t('Demand')}</th><th className="r hide-m">{t('Price per unit')}</th><th className="hide-m">{t('Forms')}</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.molecule_id}>
                    <td><Link href={`/m/molecules/${r.molecule_id}?market=${m}`}><span className="nm">{r.inn}</span></Link>
                      <div className="sub2">{r.category ? t(r.category) : t('Class not set')}{r.on_national_list ? ` · ${t('essential list')}` : ''}{r.mine ? ` · ${t('in your catalogue')}` : ''}{r.local_made ? ` · ${r.local_made} made locally` : ''}</div></td>
                    <td className="r">{r.registrants === 0 ? <span className="pill peach">{t('Open')}</span> : <span className="num">{r.registrants}</span>}
                      {r.registrations > 0 && <div className="sub2">{t('{n} products', { n: r.registrations })}</div>}</td>
                    <td className="hide-m">{r.demand != null ? <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }} title={`${Number(r.demand).toFixed(2)} of 1: essential lists, facility level, tenders, registered products, shelf listings`}><div className="meter" style={{ width: 56, flex: 'none' }}><i style={{ width: `${Math.round(Number(r.demand) * 100)}%` }} /></div><span className={`pill ${demandTone(r.demand)}`}>{t(demandLabel(r.demand))}</span></div> : <span className="muted">—</span>}</td>
                    <td className="r hide-m">{r.unit_usd != null ? <><span className="num">{usd(r.unit_usd)}</span> <ConfidenceChip level={r.confidence} /></> : <span className="muted">—</span>}</td>
                    <td className="hide-m small muted">{r.forms ?? ''}</td>
                    <td className="r"><Link className="btn btn-ghost btn-sm" href={`/m/molecules/${r.molecule_id}?market=${m}`}>{t('View')}</Link></td>
                  </tr>))}</tbody>
              </table></div>)}
            {!full && d.list.length > shown.length && (
              <PlanLock need="data" title={t('{n} more molecules', { n: d.list.length - shown.length })} u={u} market={m}>
                {t('The whole list for {market}, every filter, saved searches that alert you, and the CSV.', { market: t(countryName(m)) })}</PlanLock>)}
          </section>
          <div className="stack">
            <section className="card stack" id="saved">
              <h2>{t('Saved searches')}</h2>
              {d.saved.length === 0 ? <p className="note">{full ? t('Filter the list, name the search and save it. Every hour we run it again; a molecule that newly matches lands in your inbox.')
                : t('On a plan, a saved search runs every hour and tells your inbox when a new molecule matches.')}</p>
                : d.saved.map((s) => (
                  <div key={s.id} className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/m/finder?${finderQuery(s.country, finderParams(s.params ?? {}))}`}><b>{s.name}</b></Link>
                      <div className="sub2">{countryName(s.country)} · {describeSearch(finderParams(s.params ?? {}))} · {s.n} matching{s.checked_at ? ` · checked ${ago(s.checked_at)}` : ''}</div>
                    </div>
                    <form action={deleteSearch}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="market" value={m} />
                      <button className="btn-link small" type="submit" aria-label={`Remove ${s.name}`}>{t('Remove')}</button></form>
                  </div>))}
            </section>
            <section className="card stack">
              <h2>{t('How to read it')}</h2>
              <p className="small muted">{t('Companies: how many hold an active registration of the molecule here; Open means nobody does. Demand: from the essential lists, facility level, public tenders, registered products and shelf listings; tenders, 0 to 1. Price: the market’s median shelf price per unit, with how sure we are.')}
                {' '}<Link href={`/m/coverage?market=${m}`}>{t('How we read {market}', { market: t(countryName(m)) })}</Link>.</p>
            </section>
          </div>
        </div>
      </>)}
    </Shell>
  );
}
