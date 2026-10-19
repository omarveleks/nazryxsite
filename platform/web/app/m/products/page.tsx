import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, dataMarkets, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import MedicineSearch from '@/components/MedicineSearch';
import AutoRefresh from '@/components/AutoRefresh';
import { Bar, Empty, Flash, LockIcon, PlanLock, Tabs } from '@/components/ui';
import { DemandIcon } from '@/components/Icons';
import { addMfrProducts, deleteAllMfrProducts, deleteMfrFile, saveLaunch, unwatchMolecule, uploadMfrFile, watchMolecule } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { HIGH_DEMAND, LAUNCH_STAGES, MFR_COUNTRIES, MFR_FILE_KINDS, canUse, countryName, covers, displayClass, productClass, tierIn, byMolecule } from '@/lib/mfr';
import { fmtDate } from '@/lib/format';
import { PRICE_SQL, formUnit, median, packOf, priceFits, unitShort, type MoleculePrice } from '@/lib/prices';
import { isDevice, productGroup } from '@/lib/segments';
import { segmentBrands } from '@/lib/competitors';

export const metadata = { title: 'My products' };

type Fact = { molecule_id: number; country: string; registrants: number; registrations: number; on_national_list: boolean; facility_level: string | null;
  rankable: boolean; score: number | null; demand: number | null };
const competition = (f?: Fact) => !f || (!f.registrations && !f.on_national_list) ? 'absent'
  : f.registrants === 0 ? 'open' : f.registrants <= 3 ? 'few' : f.registrants < 8 ? 'some' : 'crowded';
const COMP: Record<string, [string, string]> = {
  // both mean nobody sells it here; 'open' is also on the country's official medicines list, so there is known demand
  open: ['No competitors, on the official list', 'peach'], few: ['1 to 3 competitors', 'mint'], some: ['4 to 7 competitors', 'blue'], crowded: ['8 or more competitors', ''],
  absent: ['No competitors', ''],
};

const PER_ML = ['eye_drops', 'nasal', 'contact_lens', 'inhaled_saline'];
// where a price can be inferred from when a market has none: its neighbours, with similar prices
// where a price can be inferred from when a market has none, nearest first; the price gap between the two countries
// (per product type, from price_gaps) carries it over. East Africa and Nigeria draw on each other and on South Asia.
const NEIGHBOURS: Record<string, string[]> = {
  TZ: ['KE', 'NG', 'IN', 'PK', 'BD'], KE: ['TZ', 'NG', 'IN', 'PK', 'BD'], NG: ['KE', 'TZ', 'GH', 'IN', 'PK', 'BD'],
  KZ: ['KG', 'UZ'], KG: ['KZ', 'UZ'], UZ: ['KZ', 'KG'],
};
// salt and hydrate words that do not change the medicine, for matching pharmacy listings to a product
const SALTS = 'sodium|potassium|calcium|magnesium|hydrochloride|hcl|dihydrochloride|hydrobromide|maleate|besilate|besylate|mesylate|mesilate|'
  + 'sulfate|sulphate|citrate|acetate|phosphate|tartrate|fumarate|succinate|bromide|dipropionate|propionate|monohydrate|dihydrate|trihydrate|anhydrous';
// a use group's product type, for its price gap
const GROUP_TYPE: Record<string, string> = { eye_drops: 'eye', contact_lens: 'eye', nasal: 'nasal', inhaled_saline: 'nasal',
  eye_surgery: 'injection', joint: 'injection', dermal_filler: 'injection' };

// The manufacturer's catalogue against its markets: a portfolio dashboard on top, then every product.
export default async function MfrProducts({ searchParams }: { searchParams: Promise<{ added?: string; matched?: string; error?: string; market?: string; tab?: string; saved?: string; uploaded?: string; removed?: string; reading?: string; cleared?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const products = await rows(db, `select p.id, p.name, p.strength, p.dosage_form, p.molecule_id, p.atc, p.use_group, p.kind, m.inn, m.category
        from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by coalesce(m.inn, p.name)`, [u.id]);
    const ids = products.map((p) => p.molecule_id).filter(Boolean);
    const facts = ids.length ? await rows(db, `select cm.molecule_id, cm.country, cm.registrants, cm.registrations, cm.on_national_list, cm.facility_level,
        coalesce(cm.rankable, false) as rankable, g.score, g.demand from country_molecules cm
        left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country
        where cm.molecule_id = any($1) and cm.country = any($2)`, [ids, dataMarkets(MFR_COUNTRIES.map((x) => x.code))]) as Fact[] : [];
    const launches = await rows(db, `select l.id, l.country, l.stage, l.updated_at, coalesce(m.inn, p.name) as name, p.id as product_id
        from launches l join mfr_products p on p.id = l.product_id left join molecules m on m.id = p.molecule_id
        where l.user_id = $1 order by l.updated_at desc`, [u.id]);
    const files = await rows(db, 'select id, kind, file_name, created_at, status, added, matched, error from mfr_files where user_id = $1 order by created_at desc', [u.id]);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    // competitor watch: the molecules followed, in the market shown, and what moved across all markets with data
    const watching = sp.tab === 'watch' && canUse(u.mfr_tier, 'competitors');
    const watched = watching && hasData(market) && covers(u, market) ? await rows(db, 'select * from my_competitor_summary($1)', [market]) : [];
    const watchCount = Number((await one(db, 'select count(*)::int as n from watches where user_id = $1', [u.id]))?.n ?? 0);
    const prices = ids.length && hasData(market) ? await rows(db, `${PRICE_SQL} where molecule_id = any($1) and country = $2`, [ids, market]) as MoleculePrice[] : [];
    // products used in one place (eye-surgery viscoelastics, nasal saline...) compete with everything registered in that group,
    // medicines and devices alike, whatever the ingredient; their price is the pharmacy median per 10 ml in the group
    const groups = [...new Set(products.map((p) => productGroup(p)).filter(Boolean))] as string[];
    // every market with data, for counts and prices where this one has none
    const live = dataMarkets(MFR_COUNTRIES.map((x) => x.code));
    const groupFacts = groups.length ? await rows(db, `select country, use_group, count(distinct company)::int as registrants, count(*)::int as registrations from (
        select country, use_group, coalesce(company_id::text, lower(coalesce(ltr, holder, manufacturer))) as company from devices where active and use_group = any($1) and country = any($2)
        union all
        select country, use_group, coalesce(ltr_id, registrant_id)::text from registrations where active and use_group = any($1) and country = any($2)) x group by 1, 2`,
      [groups, live]) : [];
    // prices: local first, then other markets converted at today's rate (shown as an estimate)
    const fx = Object.fromEntries((await rows(db, 'select currency, per_usd::float as r from fx_rates')).map((x) => [x.currency, x.r]));
    const curOf = Object.fromEntries((await rows(db, 'select country, min(currency) as c from price_listings group by country')).map((x) => [x.country, x.c]));
    const order = [market, ...(NEIGHBOURS[market] ?? [])].filter((c) => curOf[c]);
    const gaps = await rows(db, `select source, form_type, ratio::float as ratio, n, basis from price_gaps where country = $1`, [market]);
    // prices only from this market and its neighbours: a far market's price level says nothing about this one
    const groupPrices: Record<string, { price: number; per: string; currency: string; n: number; from: string }> = {};
    for (const g of groups) for (const c of order) {
      const brands = await segmentBrands(db, c, g, []);
      const v = PER_ML.includes(g) ? median(brands.map((b) => b.per10).filter((x): x is number => x != null)) : median(brands.flatMap((b) => b.prices));
      const n = PER_ML.includes(g) ? brands.filter((b) => b.per10 != null).length : brands.filter((b) => b.prices.length).length;
      if (v != null) { groupPrices[g] = { price: v, per: PER_ML.includes(g) ? '10 ml' : 'pack', currency: curOf[c], n, from: c }; break; }
    }
    const otherPrices = ids.length ? await rows(db, `${PRICE_SQL} where molecule_id = any($1) and country <> $2`, [ids, market]) as MoleculePrice[] : [];
    // pharmacy packs of the same ingredient whatever its salt is called ('Bromfenac Sodium' is Bromfenac), under the product's molecule
    const listings = ids.length ? await rows(db, `with k as (select id, trim(regexp_replace(regexp_replace(lower(inn), '\\m(${SALTS})\\M', '', 'g'), '\\s+', ' ', 'g')) as k
          from molecules), sib as (select a.id as mine, b.id as other from k a join k b on a.k = b.k and a.k <> '' where a.id = any($1))
        select l.country, sib.mine as molecule_id, l.name, l.pack_price::float as price, l.currency from price_listings l join sib on sib.other = l.molecule_id
        where l.kind = 'retail' and l.pack_price > 0`, [ids]) : [];
    const local = curOf[market] ?? null;
    return { targets, market, products, facts, launches, files, watched, watchCount, prices, groupFacts, groupPrices, listings, otherPrices, fx, local, order, gaps };
  });
  const market = d.market;
  const analysis = canUse(tierIn(u, market), 'portfolio');
  const reading = d.files.filter((x) => x.kind === 'catalogue' && (x.status === 'queued' || x.status === 'reading'));
  const lastCat = d.files.find((x) => x.kind === 'catalogue');
  const fact = (mol: number | null, c: string) => d.facts.find((f) => f.molecule_id === mol && f.country === c);
  const focus = hasData(market) ? market : null;      // the market the dashboard reads

  const groupFact = (g: string, c = market): Fact => {
    const x = d.groupFacts.find((r) => r.use_group === g && r.country === c);
    return { molecule_id: 0, country: c, registrants: x?.registrants ?? 0, registrations: x?.registrations ?? 0, on_national_list: false,
      facility_level: null, rankable: false, score: null, demand: null };
  };
  const list = d.products.map((p) => {
    const group = productGroup(p);
    return { ...p, group, device: isDevice(p), cls: displayClass(p), f: focus ? (group ? groupFact(group) : fact(p.molecule_id, focus)) : undefined };
  })
    .sort((a, b) => (b.f?.score ?? -1) - (a.f?.score ?? -1) || String(a.inn ?? a.name).localeCompare(String(b.inn ?? b.name)));
  // doses, forms and packs of one medicine count once: the analysis and the list are by molecule
  const mols = byMolecule(list);
  const packs = list.length, n = mols.length, matched = list.filter((p) => p.molecule_id || p.group).length;
  const by = (k: string) => mols.filter((p) => competition(p.f) === k).length;
  const onMarket = mols.filter((p) => p.f && p.f.registrants > 0);
  const avg = onMarket.length ? (onMarket.reduce((s, p) => s + p.f!.registrants, 0) / onMarket.length).toFixed(1) : '—';
  const classes = Object.entries(mols.reduce<Record<string, typeof mols>>((acc, p) => { const c = p.cls ?? 'Not classified'; (acc[c] ??= []).push(p); return acc; }, {}))
    .map(([cls, ps]) => {
      const on = ps.filter((p) => p.f && p.f.registrants > 0);
      return { cls, n: ps.length, open: ps.filter((p) => competition(p.f) === 'open').length,
        avg: on.length ? (on.reduce((s, p) => s + p.f!.registrants, 0) / on.length).toFixed(1) : '—' };
    }).sort((a, b) => b.n - a.n);
  const top = classes.find((c) => c.cls !== 'Not classified');
  // a price for every product we can: same group, the ingredient's average in the same form, pharmacy packs in the same form;
  // here first, then from another market converted to this one's currency (an estimate)
  const conv = (v: number, from: string) => d.local && d.fx[from] && d.fx[d.local] ? v / d.fx[from] * d.fx[d.local] : null;
  // this market's price over the source country's for this type: measured (10+ medicines), else the set figure, else 1
  const gap = (src: string, type: string) => {
    const pick = (t: string, basis: string) => d.gaps.find((g) => g.source === src && g.form_type === t && g.basis === basis && (basis === 'set' || g.n >= 10));
    return (pick(type, 'measured') ?? pick(type, 'set') ?? pick('all', 'set'))?.ratio ?? 1;
  };
  const typeOf = (form?: string | null) => { const u = formUnit(form);
    return u === 'tablet or capsule' ? 'tablet' : u === 'ampoule or vial' ? 'injection' : /eye|ophth/i.test(form ?? '') ? 'eye' : /nasal|nose/i.test(form ?? '') ? 'nasal' : 'all'; };
  const priceFor = (p: (typeof mols)[number]): { price: number; per: string; currency: string } | null => {
    // a price from another country: converted at today's rate and carried over by the price gap for this product type
    const out = (v: number | null, cur: string, per: string, from = market, type = 'all') => {
      if (v == null) return null;
      const x = cur === d.local ? v : conv(v, cur);
      return x == null ? null : { price: from === market ? x : x * gap(from, type), per, currency: d.local! };
    };
    if (p.group) {
      const gp = d.groupPrices[p.group];
      return gp ? out(gp.price, gp.currency, gp.per, gp.from, GROUP_TYPE[p.group] ?? 'all') : null;
    }
    if (!p.molecule_id) return null;
    const u = formUnit(p.dosage_form);
    for (const c of d.order) {
      const pr = (c === market ? d.prices : d.otherPrices).find((x) => x.molecule_id === p.molecule_id && x.country === c);
      if (pr && priceFits(pr, p.dosage_form)) {
        const per = packOf(pr) > 1 ? `${packOf(pr)} ${pr.unit}` : unitShort(pr);
        // the generic's price: what a generic sells for
        const r = out(Number(pr.unit_price) * packOf(pr), pr.currency, per, c, typeOf(p.dosage_form));
        if (r) return r;
      }
      const same = d.listings.filter((l) => l.country === c && l.molecule_id === p.molecule_id && (!u || !formUnit(l.name) || formUnit(l.name) === u));
      const r = out(median(same.map((l) => l.price)), same[0]?.currency, 'pack', c, typeOf(p.dosage_form));
      if (r) return r;
    }
    return null;
  };
  const visible = (i: number) => analysis || i < 3;

  return (
    <Shell user={u} title="My products" sub={`Your catalogue against ${countryName(market)}`}
      actions={<a className="btn btn-blue btn-sm" href="/m/products#add">Add a product</a>}>
      <Flash sp={sp} />
      {sp.cleared && <div className="ok" role="status">All products removed.</div>}
      {reading.length > 0 && (<div className="ok row" role="status" style={{ gap: 10 }}><AutoRefresh />
        <span className="spin" aria-hidden="true" />Reading {reading.map((x) => x.file_name).join(', ')}. Your products appear here in a minute; no need to wait on this page.</div>)}
      {sp.reading && reading.length === 0 && lastCat?.status === 'done' && <div className="ok" role="status">Added {lastCat.added} products from {lastCat.file_name}; {lastCat.matched} matched to a molecule we track.
        {lastCat.added > lastCat.matched ? ' Our team matches the rest.' : ''}</div>}
      {sp.reading && reading.length === 0 && lastCat && lastCat.status !== 'done' && <div className="ok" role="status">We could not read {lastCat.file_name} by ourselves. Our team is adding its products, usually within one working day.</div>}
      {sp.uploaded && <div className="ok" role="status">{sp.uploaded === 'gmp' ? 'GMP certificate received. Our team checks it for your Verified badge.' : 'Document received.'}</div>}
      {sp.added && <div className="ok" role="status">Added {sp.added} products; {sp.matched} matched to a molecule we track.
        {Number(sp.added) > Number(sp.matched) ? ' Our team matches the rest.' : ''}</div>}
      <Tabs current={sp.tab === 'launches' || sp.tab === 'watch' ? sp.tab : 'portfolio'} items={[
        { key: 'portfolio', label: 'Portfolio', href: '/m/products' },
        { key: 'watch', label: `Competitor watch${d.watchCount ? ` (${d.watchCount})` : ''}`, href: '/m/products?tab=watch' },
        { key: 'launches', label: `Launch tracker${d.launches.length ? ` (${d.launches.length})` : ''}`, href: '/m/products?tab=launches' }]} />
      {sp.tab === 'watch' ? (
        !canUse(u.mfr_tier, 'competitors') ? (
          <PlanLock need="data" title="Competitor watch">Follow any molecule. See every new competitor in your markets, where their product is made,
            and get an alert by email or WhatsApp the week it is registered.</PlanLock>
        ) : (<>
          <MarketPicker u={u} targets={d.targets} current={market} path="/m/products?tab=watch" />
          <section className="card stack">
            <div className="card-h"><div><h2>Molecules you watch</h2><p className="note">Who sells each molecule in {countryName(market)} today, and what changed in the last 90 days.
              We alert you by email or WhatsApp when a new competitor is registered.</p></div>
              {d.products.some((p) => p.molecule_id) && <form action={watchMolecule}><input type="hidden" name="all" value="1" />
                <button className="btn btn-ghost btn-sm" type="submit">Watch all my products</button></form>}</div>
            {!hasData(market) ? <AgencyMarket code={market} /> : !covers(u, market) ? <PlanLock need="data" title={`Competitors in ${countryName(market)}`} u={u} market={market} /> : d.watched.length === 0 ? <Empty>You are not watching any molecule yet. Watch all your products, or add one below.</Empty> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Molecule</th><th className="r">Companies</th><th className="r">Products</th><th>Last 90 days</th><th className="hide-m">Made in</th><th /></tr></thead>
                <tbody>{d.watched.map((w) => (
                  <tr key={w.molecule_id}><td><b>{w.molecule}</b><div className="sub2">{w.category ?? ''}</div></td>
                    <td className="r num">{w.competitors}</td>
                    <td className="r num">{w.products}</td>
                    <td className="small">{w.new_90 || w.gone_90 ? <>
                      {w.new_90 > 0 && <span className="pill peach num">+{w.new_90} new</span>}{' '}
                      {w.gone_90 > 0 && <span className="pill num">{w.gone_90} gone</span>}
                      <div className="sub2">latest {fmtDate(w.last_move)}</div></> : <span className="muted">No change</span>}</td>
                    <td className="small hide-m">{w.made_in ?? '—'}</td>
                    <td className="r"><form action={unwatchMolecule}><input type="hidden" name="molecule_id" value={w.molecule_id} />
                      <input type="hidden" name="return" value={`/m/products?tab=watch&market=${market}`} />
                      <button className="btn-link small" type="submit">Stop watching</button></form></td></tr>))}</tbody></table></div>)}
            <form action={watchMolecule} className="row" style={{ maxWidth: 560 }}>
              <input type="hidden" name="return" value={`/m/products?tab=watch&market=${market}`} />
              <input className="input" name="name" placeholder="Watch another molecule, e.g. by its generic name" aria-label="Molecule to watch" required style={{ flex: '1 1 220px' }} />
              <button className="btn btn-blue btn-sm" type="submit">Watch</button>
            </form>
          </section>
        </>)
      ) : sp.tab === 'launches' ? (
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
      <MarketPicker u={u} targets={d.targets} current={market} path="/m/products" />

      {!hasData(market) ? <AgencyMarket code={market} /> : n > 0 && (<>
        <div className="grid g4" data-tour="portfolio">
          <div className="tile t-white"><span className="k">Medicines</span><span className="v num">{n}</span><span className="small">{packs} products{packs > matched ? `, ${packs - matched} not matched yet` : ''}</span></div>
          <div className="tile t-peach"><span className="k"><DemandIcon /> In high demand</span>
            <span className="v num">{mols.filter((p) => Number(p.f?.demand ?? 0) >= HIGH_DEMAND).length}</span>
            <span className="small">{by('open') + by('absent')} of your medicines have no competitors here</span></div>
          {analysis ? (<>
            <div className="tile t-blue"><span className="k">Average competitors</span><span className="v num">{avg}</span><span className="small">per medicine already on the market</span></div>
            <div className="tile t-mint"><span className="k">Top class</span><span className="v" style={{ fontSize: 20, lineHeight: 1.2 }}>{top?.cls ?? '—'}</span>
              <span className="small">{top ? `${top.n} of your medicines` : ''}</span></div>
          </>) : <div style={{ gridColumn: 'span 2' }}><PlanLock need="data" title="Your portfolio analysis" u={u} market={market}>Competition and depth for every product, your strongest classes, and where you are open.</PlanLock></div>}
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
        <div className="card-h"><h2>All medicines</h2>
          <span className="row" style={{ gap: 10 }}><span className="note">{analysis ? 'Clearest openings first' : 'Your top 3 shown in full'}</span>
            {n > 0 && <details style={{ position: 'relative' }}><summary className="btn-link small" style={{ cursor: 'pointer', listStyle: 'none' }}>Remove all</summary>
              <form action={deleteAllMfrProducts} className="card stack small" style={{ position: 'absolute', right: 0, zIndex: 5, width: 240, marginTop: 6 }}>
                <span>Remove all {packs} {packs === 1 ? "product" : "products"} from your portfolio? This cannot be undone.</span>
                <button className="btn btn-sm" type="submit">Yes, remove all</button>
              </form></details>}</span></div>
        {n === 0 ? <Empty>No products yet. Search for your first one below.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Product</th><th className="hide-m">Class</th>
              <th className="r">Competition in {countryName(market)}</th><th className="r hide-m">Average price</th></tr></thead>
            <tbody>{mols.map((p, i) => (
              <tr key={p.id}>
                <td><Link href={`/m/products/${p.id}`}><b>{p.inn ?? p.name}</b></Link>
                  {Number(p.f?.demand ?? 0) >= HIGH_DEMAND && visible(i) && <span style={{ marginLeft: 6, color: 'var(--pastel-peach-ink)' }}><DemandIcon size={11} title="High demand" /></span>}
                  <div className="sub2">{[p.packs > 1 ? `${p.packs} products` : p.inn ? p.name : null, p.variants || null, p.device ? 'Medical device' : p.molecule_id ? null : 'Not matched yet'].filter(Boolean).join(' · ')}</div></td>
                <td className="small hide-m">{p.cls ?? '—'}</td>
                {[market].map((c) => {
                  const f = p.f;
                  return <td key={c} className="r">{!hasData(c) ? <span className="pill blue">Managed by Nazryx</span>
                    : !visible(i) ? <span className="note row" style={{ justifyContent: 'flex-end', gap: 4 }}><LockIcon /> Locked</span>
                    : <><span className={`pill ${COMP[competition(f)][1]}`}>{competition(f) === 'some' || competition(f) === 'crowded' ? `${f!.registrants} competitors` : competition(f) === 'few' ? `${f!.registrants} ${f!.registrants === 1 ? 'competitor' : 'competitors'}` : COMP[competition(f)][0]}</span>
                      {(competition(f) === 'absent' || competition(f) === 'open') && (() => {   // where it sells among the other markets with data
                        const o = (p.group ? d.groupFacts.filter((x) => x.use_group === p.group && x.country !== c)
                          : d.facts.filter((x) => x.molecule_id === p.molecule_id && x.country !== c))
                          .filter((x) => x.registrations > 0 && d.targets.includes(x.country));
                        return o.length ? <div className="sub2">{o.map((x) => `${countryName(x.country)}: ${x.registrants} ${x.registrants === 1 ? 'competitor' : 'competitors'}`).join(' · ')}</div> : null;
                      })()}</>}</td>;
                })}
                <td className="r small hide-m num">{(() => {
                  if (!visible(i)) return '—';
                  const q = priceFor(p);
                  const fmt = (v: number) => `${q!.currency} ${Math.round(v).toLocaleString('en')}`;
                  return q ? <>{fmt(q.price)} / {q.per}<div className="sub2">Est. avg</div></> : '—';
                })()}</td>
              </tr>))}</tbody></table></div>)}
      </section>

      </>)}
      {sp.tab !== 'watch' && sp.tab !== 'launches' && (<>
      <section className="card stack" id="add" data-tour="add-products">
        <h2>Add a product</h2>
        <p className="note">Search by name. Not there? Add it as written and our team takes care of it.</p>
        <div style={{ maxWidth: 560 }}><MedicineSearch /></div>
        <form action={uploadMfrFile} className="row" style={{ maxWidth: 560, padding: '10px 12px', border: '1px dashed var(--line)', borderRadius: 12 }}>
          <input type="hidden" name="kind" value="catalogue" /><input type="hidden" name="return" value="/m/products#add" />
          <span className="small" style={{ flex: '1 1 100%' }}><b>Or upload your catalogue</b> as PDF, Excel, Word or CSV. Every product is added for you in a minute.</span>
          <input name="file" type="file" required aria-label="Catalogue file" accept=".pdf,.xls,.xlsx,.csv,.doc,.docx,.txt" style={{ flex: '1 1 200px', minWidth: 0 }} />
          <button className="btn btn-ghost btn-sm" type="submit">Upload</button>
        </form>
        <details>
          <summary className="btn-link">Add many at once</summary>
          <form action={addMfrProducts} className="stack" style={{ marginTop: 10, maxWidth: 560 }}>
            <label className="lbl" htmlFor="list">Paste your product list, one product per line</label>
            <textarea className="input" id="list" name="list" rows={8} required placeholder={'Amoxicillin 500 mg capsules\nCeftriaxone 1 g injection\nMetformin 500 mg tablets'} />
            <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Add and match</button>
          </form>
        </details>
      </section>
      <section className="card stack" id="files">
        <div className="card-h"><div><h2>Your documents</h2><p className="note">Catalogues, and the small starter pack we check first: GMP certificate, CPP,
          certificate of analysis, labels. Full dossiers only when we review one for you. A checked GMP certificate earns your Verified badge.</p></div></div>
        {d.files.length > 0 && (
          <div className="tbl-wrap"><table className="tbl"><tbody>{d.files.map((x) => (
            <tr key={x.id}><td><a href={`/files/mfile/${x.id}`}><b>{x.file_name}</b></a><div className="sub2">{MFR_FILE_KINDS[x.kind]} · {fmtDate(x.created_at)}{x.kind === 'catalogue' ? ` · ${
                x.status === 'done' ? `${x.added} products added` : x.status === 'queued' || x.status === 'reading' ? 'reading now' : x.status ? 'our team is adding the products' : ''}` : ''}</div></td>
              <td className="r"><form action={deleteMfrFile}><input type="hidden" name="file_id" value={x.id} />
                <button className="btn-link small" type="submit">Remove</button></form></td></tr>))}</tbody></table></div>)}
        <form action={uploadMfrFile} className="row" style={{ maxWidth: 640 }}>
          <input type="hidden" name="return" value="/m/products#files" />
          <select className="input" name="kind" aria-label="What the file is" defaultValue="gmp" style={{ flex: '1 1 180px' }}>
            {Object.entries(MFR_FILE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input name="file" type="file" required aria-label="File" accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv,.doc,.docx,.txt" style={{ flex: '1 1 200px', minWidth: 0 }} />
          <button className="btn btn-blue btn-sm" type="submit">Upload</button>
        </form>
      </section>
      </>)}
    </Shell>
  );
}
