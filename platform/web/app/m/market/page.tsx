import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, ManagedShowcase, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import YearChart from '@/components/YearChart';
import { PlanLock } from '@/components/ui';
import { OpeningIcon } from '@/components/Icons';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { HIGH_DEMAND, canUse, countryName } from '@/lib/mfr';
import { REQ_SQL, type Requirement } from '@/lib/regulatory';

export const metadata = { title: 'Market' };

type Db = Parameters<Parameters<typeof withUser>[1]>[0];

async function headline(db: Db, c: string, uid: string) {
  return one(db, `select
      (select count(*)::int from registrations where country = $1 and active) as products,
      (select count(distinct ltr_id)::int from registrations where country = $1 and active) as distributors,
      (select count(distinct molecule_id)::int from registrations where country = $1 and active) as molecules,
      (select count(*)::int from country_molecules where country = $1 and on_national_list and registrants = 0 and rankable) as open,
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
  const full = canUse(u.mfr_tier, 'market');
  const d = await withUser(u.id, async (db) => {
    const p = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    await loadLive(db);
    const targets = targetMarkets(p?.target_countries);
    const market = pickMarket(sp.market, targets, p?.primary_market);
    const reqs = (await rows(db, REQ_SQL, [market]) as Requirement[]).filter((r) => r.applies === 'all');
    if (!hasData(market)) return { targets, market, reqs };
    const h = await headline(db, market, u.id);
    if (!full) return { targets, market, reqs, h };
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
    const routes = await rows(db, 'select label, description, months_low, months_high from registration_routes order by sort');
    return { targets, market, reqs, h, cats, origin, years, routes };
  });
  const m = d.market;
  return (
    <Shell user={u} title="Market" sub={hasData(m) ? `${countryName(m)}: size, openings and competition` : `${countryName(m)}: managed by Nazryx`}
      actions={hasData(m) ? (canUse(u.mfr_tier, 'market_read') ? <Link className="btn btn-ghost btn-sm" href={`/m/report?market=${m}`}>Download market read</Link>
        : <PlanLock compact need="data" title="Market read (PDF)" />) : undefined}>
      <MarketPicker targets={d.targets} current={m} path="/m/market" />

      {!hasData(m) && <AgencyMarket code={m} />}

      {d.h && (<>
        <div className="grid g4" data-tour="market">
          <div className="tile t-blue"><span className="k">Registered products</span><span className="v num">{d.h.products.toLocaleString('en')}</span></div>
          <div className="tile t-mint"><span className="k">Distributors holding registrations</span><span className="v num">{d.h.distributors}</span></div>
          <div className="tile t-lav"><span className="k">Molecules on the market</span><span className="v num">{d.h.molecules}</span></div>
          <div className="tile t-peach"><span className="k"><OpeningIcon /> Essential medicines nobody registered</span><span className="v num">{d.h.open}</span></div>
        </div>
        <section className="card between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span><b>Your catalogue here:</b> {d.h.mine_high} of your molecules are in high demand in {countryName(m)}, and {d.h.mine_on_market} are already
            sold there.</span>
          <Link className="btn btn-blue btn-sm" href={`/m/products?market=${m}`}>See your products</Link>
        </section>
        {d.reqs.length > 0 && (
          <section className="card stack" style={{ gap: 8 }}>
            <div className="card-h"><h2>What {countryName(m)} requires</h2><Link className="btn-link" href={`/m/regulatory?market=${m}`}>All requirements, and yours by product</Link></div>
            <div className="grid g3" style={{ gap: 8 }}>{d.reqs.slice(0, 6).map((r) => (
              <div key={r.id} className="small"><span className="lbl">{r.topic}</span><div><b>{r.title}</b></div><div className="muted">{r.body}</div></div>))}</div>
          </section>)}
        {!full ? (
          <PlanLock need="data" title={`The full ${countryName(m)} market`}>
            Every therapeutic class with its competition and openings, where registered products are made, how fast new registrations arrive,
            and the registration routes and timelines.
          </PlanLock>
        ) : (<>
          <div className="split">
            <section className="card">
              <div className="card-h"><div><h2>By therapeutic class</h2><p className="note">Classes of the official list. Open means nobody has registered it.</p></div></div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Class</th><th className="r">Products</th><th className="r">Companies per molecule</th><th className="r">Open</th><th className="r">Yours</th></tr></thead>
                <tbody>{d.cats!.map((c) => (
                  <tr key={c.category}><td>{c.category}</td><td className="r num">{c.products}</td><td className="r num">{c.per_molecule}</td>
                    <td className="r num">{c.open}</td><td className="r num">{c.yours || '—'}</td></tr>))}</tbody></table></div>
            </section>
            <div className="stack">
              <section className="card">
                <div className="card-h"><h2>Where registered products are made</h2></div>
                {(() => { const all = d.origin!.reduce((s, o) => s + o.n, 0) || 1; return d.origin!.map((o) => (
                  <div key={o.country} className="between small" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                    <span>{o.country}</span><span className="num">{o.n} · {Math.round((100 * o.n) / all)}%</span></div>)); })()}
              </section>
              <section className="card stack">
                <h2>Getting registered</h2>
                {d.routes!.map((r) => (
                  <div key={r.label}><b>{r.label}</b>{r.months_low != null ? <span className="muted"> · about {r.months_low}–{r.months_high ?? r.months_low} months</span> : null}
                    <div className="note">{r.description}</div></div>))}
              </section>
            </div>
          </div>
          <section className="card">
            <div className="card-h"><h2>Registrations by certificate year</h2><span className="note">Products still registered today</span></div>
            <YearChart data={d.years!} />
          </section>
        </>)}
      </>)}
      <ManagedShowcase codes={d.targets.filter((c) => c !== m && !hasData(c))} />
    </Shell>
  );
}
