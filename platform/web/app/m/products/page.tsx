import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, dataMarkets, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import MedicineSearch from '@/components/MedicineSearch';
import { Bar, Empty, Flash, LockIcon, PlanLock, Tabs } from '@/components/ui';
import { DemandIcon } from '@/components/Icons';
import { addMfrProducts, saveLaunch } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { HIGH_DEMAND, LAUNCH_STAGES, canUse, countryName, productClass } from '@/lib/mfr';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'My products' };

type Fact = { molecule_id: number; country: string; registrants: number; registrations: number; on_national_list: boolean; facility_level: string | null;
  rankable: boolean; score: number | null; demand: number | null };
const competition = (f?: Fact) => !f || (!f.registrations && !f.on_national_list) ? 'absent'
  : f.registrants === 0 ? 'open' : f.registrants <= 3 ? 'few' : f.registrants < 8 ? 'some' : 'crowded';
const COMP: Record<string, [string, string]> = {
  open: ['Nobody registered', 'peach'], few: ['1 to 3 competitors', 'mint'], some: ['4 to 7 competitors', 'blue'], crowded: ['8 or more competitors', ''],
  absent: ['Not on this market yet', ''],
};

// The manufacturer's catalogue against its markets: a portfolio dashboard on top, then every product.
export default async function MfrProducts({ searchParams }: { searchParams: Promise<{ added?: string; matched?: string; error?: string; market?: string; tab?: string; saved?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const analysis = canUse(u.mfr_tier, 'portfolio');
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(prof?.target_countries);
    const products = await rows(db, `select p.id, p.name, p.strength, p.dosage_form, p.molecule_id, p.atc, m.inn, m.category
        from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by coalesce(m.inn, p.name)`, [u.id]);
    const ids = products.map((p) => p.molecule_id).filter(Boolean);
    const facts = ids.length ? await rows(db, `select cm.molecule_id, cm.country, cm.registrants, cm.registrations, cm.on_national_list, cm.facility_level,
        coalesce(cm.rankable, false) as rankable, g.score, g.demand from country_molecules cm
        left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country
        where cm.molecule_id = any($1) and cm.country = any($2)`, [ids, dataMarkets(targets)]) as Fact[] : [];
    const launches = await rows(db, `select l.id, l.country, l.stage, l.updated_at, coalesce(m.inn, p.name) as name, p.id as product_id
        from launches l join mfr_products p on p.id = l.product_id left join molecules m on m.id = p.molecule_id
        where l.user_id = $1 order by l.updated_at desc`, [u.id]);
    return { targets, products, facts, launches };
  });
  const market = pickMarket(sp.market, d.targets);
  const fact = (mol: number | null, c: string) => d.facts.find((f) => f.molecule_id === mol && f.country === c);
  const live = dataMarkets(d.targets);
  const focus = market === 'all' ? live[0] : market;      // the market the dashboard reads (all: the first with data)

  const list = d.products.map((p) => ({ ...p, cls: productClass(p), f: focus ? fact(p.molecule_id, focus) : undefined }))
    .sort((a, b) => (b.f?.score ?? -1) - (a.f?.score ?? -1) || String(a.inn ?? a.name).localeCompare(String(b.inn ?? b.name)));
  const n = list.length, matched = list.filter((p) => p.molecule_id).length;
  const by = (k: string) => list.filter((p) => competition(p.f) === k).length;
  const onMarket = list.filter((p) => p.f && p.f.registrants > 0);
  const avg = onMarket.length ? (onMarket.reduce((s, p) => s + p.f!.registrants, 0) / onMarket.length).toFixed(1) : '—';
  const classes = Object.entries(list.reduce<Record<string, typeof list>>((acc, p) => { const c = p.cls ?? 'Not classified'; (acc[c] ??= []).push(p); return acc; }, {}))
    .map(([cls, ps]) => {
      const on = ps.filter((p) => p.f && p.f.registrants > 0);
      return { cls, n: ps.length, open: ps.filter((p) => competition(p.f) === 'open').length,
        avg: on.length ? (on.reduce((s, p) => s + p.f!.registrants, 0) / on.length).toFixed(1) : '—' };
    }).sort((a, b) => b.n - a.n);
  const top = classes.find((c) => c.cls !== 'Not classified');
  const visible = (i: number) => analysis || i < 3;

  return (
    <Shell user={u} title="My products" sub={market === 'all' ? 'Your catalogue across your markets' : `Your catalogue against ${countryName(market)}`}
      actions={<a className="btn btn-blue btn-sm" href="#add">Add a product</a>}>
      <Flash sp={sp} />
      {sp.added && <div className="ok" role="status">Added {sp.added} products; {sp.matched} matched to a molecule we track.
        {Number(sp.added) > Number(sp.matched) ? ' Our team matches the rest.' : ''}</div>}
      <Tabs current={sp.tab === 'launches' ? 'launches' : 'portfolio'} items={[
        { key: 'portfolio', label: 'Portfolio', href: '/m/products' },
        { key: 'launches', label: `Launch tracker${d.launches.length ? ` (${d.launches.length})` : ''}`, href: '/m/products?tab=launches' }]} />
      {sp.tab === 'launches' ? (
        <section className="card">
          <div className="card-h"><div><h2>Launch tracker</h2><p className="note">Each product in each market, from chosen to on the shelf. Add products from their page.</p></div></div>
          {d.launches.length === 0 ? <Empty>Nothing on the tracker yet. Open a product and add it for a market.</Empty> : (
            <div className="board b5">{LAUNCH_STAGES.map(([k, label]) => (
              <div key={k} className="col"><div className="between small"><b>{label}</b><span className="muted num">{d.launches.filter((l) => l.stage === k).length}</span></div>
                {d.launches.filter((l) => l.stage === k).map((l) => (
                  <div key={l.id} className="rcard stack" style={{ gap: 6 }}>
                    <Link href={`/m/products/${l.product_id}?market=${l.country}`}><b>{l.name}</b></Link>
                    <span className="sub2">{countryName(l.country)} · {fmtDate(l.updated_at)}</span>
                    <form action={saveLaunch} className="stack" style={{ gap: 6 }}>
                      <input type="hidden" name="product_id" value={l.product_id} /><input type="hidden" name="country" value={l.country} />
                      <select className="input" name="stage" defaultValue={l.stage} aria-label={`Stage for ${l.name}`} style={{ minHeight: 34, fontSize: 13 }}>
                        {LAUNCH_STAGES.map(([s, sl]) => <option key={s} value={s}>{sl}</option>)}</select>
                      <button className="btn btn-ghost btn-sm" type="submit">Move</button>
                    </form>
                  </div>))}
              </div>))}</div>)}
        </section>
      ) : (<>
      <MarketPicker targets={d.targets} current={market} path="/m/products" />

      {market !== 'all' && !hasData(market) ? <AgencyMarket code={market} /> : n > 0 && (<>
        <div className="grid g4" data-tour="portfolio">
          <div className="tile t-white"><span className="k">Products</span><span className="v num">{n}</span><span className="small">{matched} matched to a molecule</span></div>
          <div className="tile t-peach"><span className="k"><DemandIcon /> In high demand{focus && market === 'all' ? ` in ${countryName(focus)}` : ''}</span>
            <span className="v num">{list.filter((p) => Number(p.f?.demand ?? 0) >= HIGH_DEMAND).length}</span>
            <span className="small">{by('open')} of your products have nobody registered</span></div>
          {analysis ? (<>
            <div className="tile t-blue"><span className="k">Average competitors</span><span className="v num">{avg}</span><span className="small">per product already on the market</span></div>
            <div className="tile t-mint"><span className="k">Top class</span><span className="v" style={{ fontSize: 20, lineHeight: 1.2 }}>{top?.cls ?? '—'}</span>
              <span className="small">{top ? `${top.n} of your products` : ''}</span></div>
          </>) : <div style={{ gridColumn: 'span 2' }}><PlanLock need="data" title="Your portfolio analysis">Competition and depth for every product, your strongest classes, and where you are open.</PlanLock></div>}
        </div>
        {analysis && (
          <div className="grid g2">
            <section className="card">
              <div className="card-h"><h2>Competition across your portfolio</h2>{focus && <span className="note">{countryName(focus)}</span>}</div>
              {['open', 'few', 'some', 'crowded', 'absent'].map((k) => <Bar key={k} label={COMP[k][0]} value={by(k)} max={n} right={by(k)} />)}
            </section>
            <section className="card">
              <div className="card-h"><h2>By therapeutic class</h2></div>
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Class</th><th className="r">Yours</th><th className="r">Avg competitors</th><th className="r">Open</th></tr></thead>
                <tbody>{classes.slice(0, 8).map((c) => <tr key={c.cls}><td>{c.cls}</td><td className="r num">{c.n}</td><td className="r num">{c.avg}</td><td className="r num">{c.open}</td></tr>)}</tbody></table></div>
            </section>
          </div>)}
      </>)}

      <section className="card">
        <div className="card-h"><h2>All products</h2><span className="note">{analysis ? 'Clearest openings first' : 'Your top 3 shown in full'}</span></div>
        {n === 0 ? <Empty>No products yet. Search for your first one below.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Product</th><th className="hide-m">Class</th>
              {market === 'all' ? live.map((c) => <th key={c} className="r">{countryName(c)}</th>) : <th className="r">Competition</th>}</tr></thead>
            <tbody>{list.map((p, i) => (
              <tr key={p.id}>
                <td><Link href={`/m/products/${p.id}${market !== 'all' ? `?market=${market}` : ''}`}><b>{p.inn ?? p.name}</b></Link>
                  {Number(p.f?.demand ?? 0) >= HIGH_DEMAND && visible(i) && <span style={{ marginLeft: 6, color: 'var(--pastel-peach-ink)' }}><DemandIcon size={11} title="High demand" /></span>}
                  <div className="sub2">{[p.inn ? p.name : null, p.molecule_id ? null : 'Not matched yet'].filter(Boolean).join(' · ')}</div></td>
                <td className="small hide-m">{p.cls ?? '—'}</td>
                {(market === 'all' ? live : [market]).map((c) => {
                  const f = fact(p.molecule_id, c);
                  return <td key={c} className="r">{!hasData(c) ? <span className="note">—</span>
                    : !visible(i) ? <span className="note row" style={{ justifyContent: 'flex-end', gap: 4 }}><LockIcon /> Locked</span>
                    : <span className={`pill ${COMP[competition(f)][1]}`}>{competition(f) === 'some' || competition(f) === 'crowded' ? `${f!.registrants} competitors` : COMP[competition(f)][0]}</span>}</td>;
                })}
              </tr>))}</tbody></table></div>)}
      </section>

      </>)}
      <section className="card stack" id="add" data-tour="add-products">
        <h2>Add a product</h2>
        <p className="note">Search by name. Not there? Add it as written and our team takes care of it.</p>
        <div style={{ maxWidth: 560 }}><MedicineSearch /></div>
        <details>
          <summary className="btn-link">Add many at once</summary>
          <form action={addMfrProducts} className="stack" style={{ marginTop: 10, maxWidth: 560 }}>
            <label className="lbl" htmlFor="list">Paste your product list, one product per line</label>
            <textarea className="input" id="list" name="list" rows={8} required placeholder={'Amoxicillin 500 mg capsules\nCeftriaxone 1 g injection\nMetformin 500 mg tablets'} />
            <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Add and match</button>
          </form>
        </details>
      </section>
    </Shell>
  );
}
