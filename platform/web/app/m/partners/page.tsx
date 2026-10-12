import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Empty, Flash, PlanLock } from '@/components/ui';
import { requestIntro } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { categories } from '@/lib/queries';
import { canUse, countryName, tierIn } from '@/lib/mfr';

export const metadata = { title: 'Distributors' };

const SIZES: [string, string][] = [['0', 'Any size'], ['20', '20+ products'], ['100', '100+ products'], ['300', '300+ products']];
const SORTS: [string, string][] = [['open', 'Sort: most open to you'], ['size', 'Sort: largest'], ['class', 'Sort: strongest in class']];

// Every distributor in a market, without names, filterable. Each profile has a code; Nazryx makes the introduction.
export default async function Partners({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, status, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(prof?.target_countries);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const cats = await categories(db);
    const mine = await rows(db, `select distinct m.id, m.inn from mfr_products p join molecules m on m.id = p.molecule_id where p.user_id = $1 order by m.inn`, [u.id]);
    const cls = sp.class && cats.includes(sp.class) ? sp.class : null;
    const molecule = mine.find((x) => x.id === Number(sp.molecule)) ?? null;
    const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : cls ? 'class' : 'open';
    const holders = hasData(market) ? Number((await one(db, 'select count(distinct ltr_id)::int as n from registrations where country = $1 and active', [market]))?.n ?? 0) : 0;
    const list = hasData(market) ? await rows(db, 'select * from partner_search($1, $2, $3, $4, $5, $6)',
      [market, cls, molecule?.id ?? null, false, Number(sp.min) || 0, sort]) : [];
    const products = await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                                     where p.user_id = $1 order by 2 limit 300`, [u.id]);
    return { targets, market, cats, mine, cls, molecule, sort, list, products, holders, status: prof?.status };
  });
  const t = tierIn(u, d.market);
  const lists = canUse(t, 'distributors'), matching = canUse(t, 'matching'), intro = canUse(t, 'partner_intro');
  const shown = d.molecule && sp.gap === '1' ? d.list.filter((p) => !p.carries) : d.list;
  const total = d.list[0]?.total ?? 0, mineN = d.list[0]?.mine ?? d.mine.length;
  const filtered = Boolean(d.cls || d.molecule || Number(sp.min));
  return (
    <Shell user={u} title="Distributors" sub={`Who could carry your products in ${countryName(d.market)}`}
      actions={intro ? <Link className="btn btn-blue btn-sm" href="/m/partners/intro">Ask us to find distributors</Link> : undefined}>
      <Flash sp={sp} />
      <MarketPicker u={u} targets={d.targets} current={d.market} path="/m/partners" />
      {!hasData(d.market) ? <AgencyMarket code={d.market} /> : (<>
        <form method="get" className="card tight stack" style={{ gap: 10 }}>
          <input type="hidden" name="market" value={d.market} />
          <div className="row">
            <select className="input" name="class" defaultValue={d.cls ?? ''} aria-label="Therapeutic class" style={{ flex: '2 1 220px' }}>
              <option value="">All therapeutic classes</option>{d.cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <select className="input" name="molecule" defaultValue={d.molecule?.id ?? ''} aria-label="One of your molecules" style={{ flex: '2 1 200px' }}>
              <option value="">Any of your molecules</option>{d.mine.map((m) => <option key={m.id} value={m.id}>{m.inn}</option>)}</select>
            <select className="input" name="min" defaultValue={sp.min ?? '0'} aria-label="Portfolio size" style={{ flex: '1 1 140px' }}>
              {SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select className="input" name="sort" defaultValue={d.sort} aria-label="Sort" style={{ flex: '1 1 200px' }}>
              {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="gap" value="1" defaultChecked={sp.gap === '1'} /> Only those who do not carry the molecule</label>
            </div>
            <div className="row">{filtered && <Link className="btn btn-ghost btn-sm" href={`/m/partners?market=${d.market}`}>Clear</Link>}
              <button className="btn btn-blue btn-sm" type="submit">Apply</button></div>
          </div>
        </form>
        <section className="card" data-tour="distributors">
          <div className="card-h"><h2>{total} distributors{d.cls ? ` in ${d.cls}` : ''}</h2></div>
          {shown.length === 0 ? (d.holders === 0 ? (
            <div className="stack" style={{ gap: 8 }}>
              <p className="muted">{countryName(d.market)}&rsquo;s register does not show which distributor holds each product, so distributors are not listed
                here. Our team knows the market and finds the right partner for you.</p>
              <Link className="btn btn-blue btn-sm" href="/m/services/market_entry" style={{ alignSelf: 'flex-start' }}>Ask our team for distributors</Link>
            </div>) : <Empty>No distributor matches these filters.</Empty>) : (
            <div>{shown.map((p, i) => (
              <div key={p.code} className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                  <span className="nm">Distributor {p.code}</span>
                  <div className="sub2">{p.products} registered products · {p.molecules} molecules · {p.classes} classes{d.cls ? ` · ${p.in_class} in ${d.cls}` : ''}</div>
                  {p.top_classes && <div className="sub2">Strongest in {p.top_classes}</div>}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {mineN > 0 && (matching ? <span className={`pill ${p.open_to > 0 ? 'mint' : ''}`}>Open to {p.open_to} of your {mineN} molecules</span>
                      : <PlanLock compact need="access" title="Open to how many of your molecules" u={u} market={d.market} />)}
                    {d.molecule && <span className={`pill ${p.carries ? '' : 'blue'}`}>{p.carries ? `Already carries ${d.molecule.inn}` : `Does not carry ${d.molecule.inn}`}</span>}
                  </div>
                </div>
                {!intro ? <PlanLock compact need="entry" title="Introduction" />
                  : <Link className="btn btn-blue btn-sm" href={`/m/partners/intro?code=${p.code}`}>Request introduction</Link>}
              </div>))}</div>)}
          {!lists && total > shown.length && (
            <div style={{ marginTop: 12 }}><PlanLock need="access" title={`${total - shown.length} more distributors`} u={u} market={d.market}>
              Every distributor in {countryName(d.market)}, with how many of your molecules each does not carry yet.</PlanLock></div>)}
        </section>
        <p className="note">Introductions are part of market entry: we contact the distributor, present your product and help agree terms.</p>
      </>)}
    </Shell>
  );
}
