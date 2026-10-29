import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { requireUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { DEPTH, DEPTH_LABEL, DEPTH_TONE, coverage, nextUp, readLine } from '@/lib/coverage';
import { countryName } from '@/lib/mfr';

export const metadata = { title: 'Coverage' };

// How we read a market: every source behind the numbers, how much of it there is, when it was last read, and what is
// still thin. The same page for every customer, free: it is how they decide what to trust.
export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const p = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(p?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, p?.primary_market);
    return { targets, market, c: hasData(market) ? await coverage(db, market) : null };
  });
  const m = d.market, c = d.c, name = countryName(m);
  const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'not yet');
  const n = (v: number) => v.toLocaleString('en');
  const Depth = ({ k }: { k: keyof typeof DEPTH }) => { const lv = c ? DEPTH[k](c) : 'thin'; return <span className={`pill ${DEPTH_TONE[lv]}`}>{DEPTH_LABEL[lv]}</span>; };
  return (
    <Shell user={u} title="How we read this market" sub={c ? readLine(c) : `${name} is managed by our team, not read from public data`}
      crumb={<><Link href={`/m/market?market=${m}`}>Market</Link> / Coverage</>}>
      <MarketPicker u={u} targets={d.targets} current={m} path="/m/coverage" />
      {c && (<>
        <section className="card stack">
          <p>Every number on {name}&rsquo;s pages comes from a public register, a procurement portal, a pharmacy shelf or our regulatory team, and says so
            where it is shown. This page is the whole picture: what we have, how fresh it is, and where it is still thin. It is the same for everyone.</p>
        </section>
        <div className="grid g2">
          <section className="card stack">
            <div className="card-h"><h2>Register</h2><Depth k="registry" /></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="tile t-blue"><span className="k">Registered products</span><span className="v num">{n(c.registry.active)}</span><span className="small">{c.registry.products > c.registry.active ? `${n(c.registry.products - c.registry.active)} lapsed also kept` : 'active'}</span></div>
              <div className="tile t-lav"><span className="k">Molecules</span><span className="v num">{n(c.registry.molecules)}</span><span className="small">{n(c.registry.companies)} companies holding them</span></div>
            </div>
            <p className="small muted">Source: {c.registry.source ?? 'the national medicines register'}. Read {date(c.registry.read_at)}. Every registration keeps its certificate number, holder, maker and year.</p>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>Prices</h2><Depth k="prices" /></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="tile t-blue"><span className="k">Prices read</span><span className="v num">{n(c.prices.listings)}</span><span className="small">from {c.prices.shops} {c.prices.shops === 1 ? 'pharmacy' : 'pharmacies'}{c.prices.official ? ` and ${c.prices.official} official ${c.prices.official === 1 ? 'list' : 'lists'}` : ''}</span></div>
              <div className="tile t-mint"><span className="k">Molecules priced</span><span className="v num">{n(c.prices.molecules)}</span><span className="small">{n(c.prices.measured)} measured · {n(c.prices.thin)} thin · {n(c.prices.estimated)} estimated</span></div>
            </div>
            <p className="small muted">Latest reading {date(c.prices.read_at)}. <b>Measured</b>: three or more products from two or more sources on this market&rsquo;s shelves.
              <b> Thin</b>: read here, from one source or fewer products. <b>Estimated</b>: no shelf price here yet; carried over from neighbouring markets by the measured price gap for that kind of product.</p>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>Tenders</h2><Depth k="tenders" /></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="tile t-blue"><span className="k">Tenders collected</span><span className="v num">{n(c.tenders.total)}</span><span className="small">{n(c.tenders.open)} open now</span></div>
              <div className="tile t-peach"><span className="k">Last 90 days</span><span className="v num">{n(c.tenders.recent)}</span><span className="small">published, closed or awarded</span></div>
            </div>
            <p className="small muted">From the official procurement portals, collected daily. Last read {date(c.tenders.read_at)}.</p>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>Regulatory</h2><Depth k="regulatory" /></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="tile t-blue"><span className="k">Requirements</span><span className="v num">{n(c.regulatory.requirements)}</span><span className="small">published, overall and per product type</span></div>
              <div className="tile t-lav"><span className="k">Routes</span><span className="v num">{n(c.regulatory.routes)}</span><span className="small">with timelines and fees</span></div>
            </div>
            <p className="small muted">Kept by the Nazryx regulatory team from the regulator&rsquo;s own publications. Last checked {date(c.regulatory.checked_at)}.</p>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>Distributors and companies</h2><Depth k="partners" /></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="tile t-blue"><span className="k">{c.partners.distributors ? 'Distributors' : 'Companies'}</span><span className="v num">{n(c.partners.distributors || c.partners.companies)}</span>
                <span className="small">{c.partners.distributors ? 'named in the register as local representative' : 'holding registrations; the register names no local representative'}</span></div>
              <div className="tile t-mint"><span className="k">Devices</span><span className="v num">{n(c.devices.total)}</span><span className="small">registered medical devices</span></div>
            </div>
            <p className="small muted">Each profile is built from the products it holds: classes, molecules, origins. Names open on Complete Market Access; the introduction is ours to make.</p>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>Imports</h2><span className={`pill ${c.trade.years >= 3 ? 'mint' : c.trade.years ? 'blue' : 'peach'}`}>{c.trade.years >= 3 ? 'Deep' : c.trade.years ? 'Fair' : 'Thin'}</span></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="tile t-blue"><span className="k">Years reported</span><span className="v num">{n(c.trade.years)}</span><span className="small">{c.trade.latest_year ? `latest ${c.trade.latest_year}` : 'not reported yet'}</span></div>
              <div className="tile t-lav"><span className="k">Lines</span><span className="v num">{c.trade.years ? 14 : 0}</span><span className="small">HS 3003, 3004 and its HS6 lines, by origin</span></div>
            </div>
            <p className="small muted">UN Comtrade, as reported by {name}&rsquo;s customs. Read monthly{c.trade.read_at ? `, last ${date(c.trade.read_at)}` : ''}. Countries report with a lag of one to two years.</p>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>Essential medicines</h2></div>
            <div className="grid g2" style={{ gap: 8 }}>
              <div className="tile t-blue"><span className="k">On the national list</span><span className="v num">{n(c.list.molecules)}</span><span className="small">molecules</span></div>
              <div className="tile t-peach"><span className="k">Nobody registered</span><span className="v num">{n(c.list.open)}</span><span className="small">openings</span></div>
            </div>
            <p className="small muted">The national essential medicines list, matched molecule by molecule against the register.</p>
          </section>
        </div>
        {nextUp(c, m).length > 0 && (
          <section className="card stack"><h2>Getting deeper</h2>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{nextUp(c, m).map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="note">Thin numbers are labelled as thin wherever they appear. If you need a number we do not have yet, ask and we read it for you within a day.</p>
          </section>)}
      </>)}
    </Shell>
  );
}
