import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, ManagedShowcase, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import YearChart from '@/components/YearChart';
import { PlanLock } from '@/components/ui';
import { OpeningIcon } from '@/components/Icons';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { HIGH_DEMAND, canUse, countryName, tierIn } from '@/lib/mfr';
import { REQ_SQL, type Requirement } from '@/lib/regulatory';
import { coverage, readLine } from '@/lib/coverage';
import { fmtDate, fmtMoney } from '@/lib/format';
import Imports from '@/components/Imports';
import { imports } from '@/lib/trade';

export const metadata = { title: 'Market' };

type Db = Parameters<Parameters<typeof withUser>[1]>[0];

async function headline(db: Db, c: string, uid: string) {
  return one(db, `select
      (select count(*)::int from registrations where country = $1 and active) as products,
      (select count(distinct ltr_id)::int from registrations where country = $1 and active) as distributors,
      (select count(distinct coalesce(ltr_id, registrant_id))::int from registrations where country = $1 and active) as companies,
      (select count(distinct molecule_id)::int from registrations where country = $1 and active) as molecules,
      (select count(*)::int from country_molecules where country = $1 and on_national_list and registrants = 0 and rankable) as open,
      (select count(distinct molecule_id)::int from mfr_products where user_id = $2 and molecule_id is not null) as mine,
      (select count(distinct p.molecule_id)::int from mfr_products p join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = $1
         where p.user_id = $2 and cm.registrations > 0) as mine_on_market,
      (select count(distinct p.molecule_id)::int from mfr_products p join visible_gap_scores g on g.molecule_id = p.molecule_id and g.country = $1
         where p.user_id = $2 and g.demand >= ${HIGH_DEMAND}) as mine_high`, [c, uid]);
}

// The market for a manufacturer: size, where the openings are by class, where registered products come from,
// how fast registrations arrive. Distributors stay anonymous on this side.
export default async function MfrMarket({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    const p = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    await loadLive(db);
    const targets = targetMarkets(p?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, p?.primary_market);
    const reqs = (await rows(db, REQ_SQL, [market]) as Requirement[]).filter((r) => r.applies === 'all');
    if (!hasData(market)) return { targets, market, reqs };
    const cov = await coverage(db, market);
    const h = await headline(db, market, u.id);
    const full = canUse(tierIn(u, market), 'market');
    const trade = await imports(db, market);          // what the country reported importing (UN Comtrade), public data
    if (!full) return { targets, market, reqs, h, cov, trade };
    const cats = await rows(db, `
      select m.category, count(*)::int as molecules, sum(cm.registrations)::int as products, round(avg(cm.registrants), 1)::float as per_molecule,
             count(*) filter (where cm.registrants = 0 and cm.rankable)::int as open,
             (select count(distinct p.molecule_id)::int from mfr_products p join molecules m2 on m2.id = p.molecule_id
                where p.user_id = $2 and m2.category = m.category) as yours
      from country_molecules cm join molecules m on m.id = cm.molecule_id
      where cm.country = $1 and cm.on_national_list and m.category is not null
      group by m.category order by products desc`, [market, u.id]);
    const origin = await rows(db, `select initcap(lower(coalesce(manufacturing_country, 'Not stated'))) as country, count(*)::int as n
        from registrations where country = $1 and active group by 1 order by n desc limit 8`, [market]);
    const years = await rows(db, `select reg_year as year, count(*)::int as n from registrations
        where country = $1 and active and reg_year between 2000 and extract(year from now())::int group by reg_year order by reg_year`, [market]);
    // this market's registration routes with realistic timelines
    const routes = await rows(db, 'select label, description, months_low, months_high from country_routes where country = $1 and scope = \'medicine\' order by sort', [market]);
    // medicine tenders collected from the market's procurement portals; the user's molecules first
    const tenders = await rows(db, `select t.id, coalesce(t.title_en, t.title) as title, coalesce(t.buyer_en, t.buyer) as buyer, t.stage, coalesce(t.awarded, t.closing, t.published) as at, t.quantity, t.unit_price, t.value,
        t.currency, t.bidders, exists (select 1 from mfr_products p where p.user_id = $2 and p.molecule_id = any(t.molecule_ids)) as mine
        from tenders t where t.country = $1 order by mine desc, coalesce(t.awarded, t.closing, t.published) desc nulls last limit 8`, [market, u.id]);
    const tcount = await one(db, `select count(*) filter (where stage = 'open')::int as open,
        count(*) filter (where coalesce(awarded, closing, published) > now() - interval '90 days')::int as recent from tenders where country = $1`, [market]);
    return { targets, market, reqs, h, cov, trade, cats, origin, years, routes, tenders, tcount };
  });
  const m = d.market;
  const full = canUse(tierIn(u, m), 'market');
  return (
    <Shell user={u} title={t('Market')} sub={hasData(m) ? `${countryName(m)}: size, openings and competition` : `${countryName(m)}: managed by Nazryx`}
      actions={hasData(m) ? (canUse(tierIn(u, m), 'market_read') ? <Link className="btn btn-ghost btn-sm" href={`/m/report?market=${m}`}>{t('Download market read')}</Link>
        : <PlanLock compact need="data" title={t('Market read (PDF)')} u={u} market={m} />) : undefined}>
      <MarketPicker u={u} targets={d.targets} current={m} path="/m/market" />
      {hasData(m) && d.cov && <p className="note">{readLine(d.cov)} · <Link className="btn-link" href={`/m/coverage?market=${m}`}>How we read {countryName(m)}</Link></p>}

      {!hasData(m) && <AgencyMarket code={m} />}

      {d.h && (<>
        <div className="grid g4" data-tour="market">
          <div className="tile t-blue"><span className="k">{t('Registered products')}</span><span className="v num">{d.h.products.toLocaleString('en')}</span></div>
          {d.h.distributors > 0
            ? <div className="tile t-mint"><span className="k">{t('Distributors holding registrations')}</span><span className="v num">{d.h.distributors}</span></div>
            : <div className="tile t-mint"><span className="k">{t('Companies holding registrations')}</span><span className="v num">{d.h.companies.toLocaleString('en')}</span></div>}
          <div className="tile t-lav"><span className="k">{t('Molecules on the market')}</span><span className="v num">{d.h.molecules}</span></div>
          <div className="tile t-peach"><span className="k"><OpeningIcon /> {t('Essential medicines nobody registered')}</span><span className="v num">{d.h.open}</span></div>
        </div>
        <section className="card between" style={{ flexWrap: 'wrap', gap: 12 }}>
          {d.h.mine > 0 ? <>
            <span><b>Your catalogue here:</b> {d.h.mine_high} of your {d.h.mine} molecules are in high demand in {countryName(m)}, and {d.h.mine_on_market} are
              already sold there.</span>
            <Link className="btn btn-blue btn-sm" href={`/m/products?market=${m}`}>{t('See your products')}</Link>
          </> : <>
            <span><b>Your catalogue here:</b> add your products and we show which are in demand in {countryName(m)} and which are already sold there.</span>
            <Link className="btn btn-blue btn-sm" href="/m/products">{t('Add your products')}</Link>
          </>}
        </section>
        {d.reqs.length > 0 && (
          <section className="card stack" style={{ gap: 8 }}>
            <div className="card-h"><h2>{t('What {market} requires', { market: t(countryName(m)) })}</h2><Link className="btn-link" href={`/m/regulatory?market=${m}`}>{t('All requirements, and yours by product')}</Link></div>
            <div className="grid g3" style={{ gap: 8 }}>{d.reqs.slice(0, 6).map((r) => (
              <div key={r.id} className="small"><span className="lbl">{r.topic}</span><div><b>{r.title}</b></div><div className="muted">{r.body}</div></div>))}</div>
          </section>)}
        {!full ? (
          <PlanLock need="data" title={t('The full {market} market', { market: t(countryName(m)) })} u={u} market={m}>
            {t('Every therapeutic class with its competition and openings, where registered products are made, how fast new registrations arrive, and the registration routes and timelines.')}
          </PlanLock>
        ) : (<>
          <div className="split">
            <section className="card">
              <div className="card-h"><div><h2>{t('By therapeutic class')}</h2><p className="note">{t('Classes of the official list. Open means nobody has registered it.')}</p></div></div>
              <div className="tbl-wrap" tabIndex={0}><table className="tbl">
                <thead><tr><th>{t('Class')}</th><th className="r">{t('Products')}</th><th className="r">{t('Companies per molecule')}</th><th className="r">{t('Open')}</th><th className="r">{t('Yours')}</th></tr></thead>
                <tbody>{d.cats!.map((c) => (
                  <tr key={c.category}><td>{t(c.category)}</td><td className="r num">{c.products}</td><td className="r num">{c.per_molecule}</td>
                    <td className="r num">{c.open}</td><td className="r num">{c.yours || '—'}</td></tr>))}</tbody></table></div>
            </section>
            <div className="stack">
              <section className="card">
                <div className="card-h"><h2>{t('Where registered products are made')}</h2></div>
                {(() => { const all = d.origin!.reduce((s, o) => s + o.n, 0) || 1; return d.origin!.map((o) => (
                  <div key={o.country} className="between small" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                    <span>{o.country}</span><span className="num">{o.n} · {Math.round((100 * o.n) / all)}%</span></div>)); })()}
              </section>
              {d.routes!.length > 0 && <section className="card stack">
                <h2>{t('Getting registered')}</h2>
                {d.routes!.map((r) => (
                  <div key={r.label}><b>{r.label}</b>{r.months_low != null ? <span className="muted"> · about {r.months_low}–{r.months_high ?? r.months_low} months</span> : null}
                    <div className="note">{r.description}</div></div>))}
              </section>}
            </div>
          </div>
          {d.trade && <Imports data={d.trade} market={m} />}
          {d.tenders!.length > 0 && (
            <section className="card stack">
              <div className="card-h"><div><h2>{t('Medicine tenders in {market}', { market: t(countryName(m)) })}</h2>
                <p className="note">{d.tcount?.open ?? 0} open now, {d.tcount?.recent ?? 0} in the last 90 days. Collected daily from the official procurement portals; yours first.</p></div>
                <Link className="btn-link" href={`/m/tenders?market=${m}`}>{t('All tenders')}</Link></div>
              {d.tenders!.map((x, i) => (
                <Link key={i} href={`/m/tenders/${x.id}`} className="between small" style={{ borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 8 : 0, gap: 12, flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                  <span style={{ minWidth: 0, flex: '1 1 260px' }}><b>{x.title}</b>{x.mine && <span className="pill blue" style={{ marginLeft: 6 }}>{t('Your molecule')}</span>}
                    <div className="sub2">{x.buyer ?? ''}{x.at ? ` · ${fmtDate(x.at)}` : ''}</div></span>
                  <span className="r">{x.quantity ? `${fmtMoney(x.quantity)} units` : ''}{x.unit_price ? ` at ${x.currency ?? ''} ${fmtMoney(x.unit_price)}` : x.value ? `${x.currency ?? ''} ${fmtMoney(x.value)}` : ''}
                    <div><span className={`pill ${x.stage === 'open' ? 'mint' : ''}`}>{x.stage === 'open' ? t('Open') : x.stage === 'awarded' ? t('Awarded') : t('Closed')}</span></div></span>
                </Link>))}
            </section>)}
          <section className="card">
            <div className="card-h"><h2>{t('Registrations by certificate year')}</h2><span className="note">{t('Products still registered today')}</span></div>
            <YearChart data={d.years!} />
          </section>
        </>)}
      </>)}
      <ManagedShowcase codes={d.targets.filter((c) => c !== m && !hasData(c))} />
    </Shell>
  );
}
