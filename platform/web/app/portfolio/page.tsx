import Link from 'next/link';
import Shell from '@/components/Shell';
import { Bar, Empty, Flash, Locked, StagePill, Tabs } from '@/components/ui';
import { DossierReadiness, QuoteTerms, ShipmentTrack } from '@/components/Pharma';
import { addCustomerSupplier, deleteCustomerSupplier, togglePortfolio } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { COVERAGE_NOTE, OFFICIAL_LIST, SHIPMENT_DOCS, levelLabel, title } from '@/lib/format';
import { COUNTRY } from '@/lib/queries';

export const metadata = { title: 'My portfolio' };

// Essential (official-list) molecules per class, and what each distributor covers: the base for coverage and benchmark.
const ESS = `ess as (select cm.molecule_id, m.category from country_molecules cm join molecules m on m.id = cm.molecule_id
                     where cm.country = '${COUNTRY}' and cm.on_national_list and cm.rankable and m.category is not null),
             tot as (select category, count(*)::int as n from ess group by 1)`;

export default async function Portfolio({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const paid = u.plan === 'paid' || u.role === 'team';
  const tab = sp.tab ?? 'coverage';
  const d = await withUser(u.id, async (db) => {
    const items = await rows(db, `select m.id, m.inn, m.category, p.source, cm.on_national_list, g.score from portfolio_items p
                                  join molecules m on m.id = p.molecule_id left join country_molecules cm on cm.molecule_id = m.id and cm.country = $2
                                  left join visible_gap_scores g on g.molecule_id = m.id and g.country = $2 where p.user_id = $1 order by m.inn`, [u.id, COUNTRY]);
    const coverage = await rows(db, `with ${ESS},
        mine as (select ess.category, count(*)::int as covered from portfolio_items p join ess on ess.molecule_id = p.molecule_id
                 where p.user_id = $1 group by 1)
        select tot.category, tot.n, coalesce(mine.covered, 0) as covered,
               (select string_agg(m.inn, ', ' order by g.score desc nulls last) from ess e join molecules m on m.id = e.molecule_id
                 left join visible_gap_scores g on g.molecule_id = e.molecule_id and g.country = '${COUNTRY}'
                 where e.category = tot.category and e.molecule_id not in (select molecule_id from portfolio_items where user_id = $1)) as missing
        from tot left join mine on mine.category = tot.category
        order by (mine.covered is null), tot.category`, [u.id]);
    const peers = await rows(db, `with ${ESS},
        comp as (select distinct r.ltr_id as cid, r.molecule_id from registrations r where r.country = '${COUNTRY}' and r.active and r.ltr_id is not null),
        cc as (select comp.cid, ess.category, count(*)::int as covered from comp join ess using (molecule_id) group by 1, 2)
        select cc.category, avg(cc.covered)::float as avg_cov, tot.n,
               (select avg(s)::float from (select 100.0 * sum(c2.covered) / sum(t2.n) as s from cc c2 join tot t2 using (category) group by c2.cid) z) as avg_score
        from cc join tot using (category) group by cc.category, tot.n order by cc.category`);
    const unreachable = paid ? await rows(db, `
        select m.id, m.inn, cm.facility_level, cm.channel_flag, g.score from country_molecules cm join molecules m on m.id = cm.molecule_id
        left join visible_gap_scores g on g.molecule_id = m.id and g.country = cm.country
        where cm.country = $2 and cm.on_national_list and cm.rankable and (cm.facility_level in ('C', 'D', 'S') or cm.channel_flag = 'programme')
          and m.category in (select m2.category from portfolio_items p join molecules m2 on m2.id = p.molecule_id where p.user_id = $1)
          and m.id not in (select molecule_id from portfolio_items where user_id = $1)
        order by g.score desc nulls last limit 12`, [u.id, COUNTRY]) : [];
    const suppliers = await rows(db, `select s.id, s.name, s.molecule_ids,
                                      (select string_agg(m.inn, ', ') from molecules m where m.id = any(s.molecule_ids)) as names
                                      from customer_suppliers s where s.user_id = $1 order by s.name`, [u.id]);
    const topPeers = paid ? await rows(db, `
        select c.id, c.display_name, count(distinct r.molecule_id)::int as shared from registrations r join companies c on c.id = r.ltr_id
        where r.active and r.molecule_id in (select molecule_id from portfolio_items where user_id = $1)
        group by c.id order by shared desc limit 5`, [u.id]) : [];
    // products sourced through Nazryx once a supplier is chosen: terms, dossier readiness and shipment, in one place
    const sourced = await rows(db, `
        select r.id as request_id, r.stage, r.molecule_id, coalesce(m.inn, r.molecule_text) as molecule,
               q.label, q.payment_terms, q.shelf_life_pct, q.gmp_by, q.supplier_type, q.exclusive,
               a.supplier_name, a.supplier_country, a.price, a.currency, a.unit, a.lead_time_weeks,
               o.id as order_id, o.status, o.eta, rd.be_status,
               coalesce((select json_agg(json_build_object('doc', sd.doc, 'ready', sd.ready)) from shipment_documents sd where sd.order_id = o.id), '[]') as docs,
               coalesce((select json_agg(json_build_object('item', di.item, 'status', di.status)) from dossier_items di where di.request_id = r.id), '[]') as ditems
        from requests r join quotes q on q.request_id = r.id and q.accepted
        left join accepted_supplier a on a.quote_id = q.id
        left join orders o on o.request_id = r.id
        left join molecules m on m.id = r.molecule_id
        left join request_dossier rd on rd.request_id = r.id
        where r.user_id = $1 order by r.updated_at desc`, [u.id]);
    return { items, coverage, peers, unreachable, suppliers, topPeers, sourced };
  });
  const yourCats = d.coverage.filter((c) => c.covered > 0);
  const yourTotal = yourCats.reduce((a, c) => a + c.n, 0);
  const yourCovered = yourCats.reduce((a, c) => a + c.covered, 0);
  const myScore = yourTotal ? Math.round((100 * yourCovered) / yourTotal) : 0;
  const avgScore = Math.round(d.peers[0]?.avg_score ?? 0);
  const supplied = new Set(d.suppliers.flatMap((s) => s.molecule_ids as number[]));
  const counts = new Map<number, number>();
  d.suppliers.forEach((s) => (s.molecule_ids as number[]).forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1)));
  const tabs = [
    { key: 'coverage', label: 'Coverage', href: '/portfolio' },
    { key: 'sourced', label: `Supply and shipments${d.sourced.length ? ` · ${d.sourced.length}` : ''}`, href: '/portfolio?tab=sourced' },
    { key: 'suppliers', label: 'Suppliers', href: '/portfolio?tab=suppliers' },
    { key: 'benchmark', label: 'Benchmark', href: '/portfolio?tab=benchmark' },
  ];
  return (
    <Shell user={u} title="My portfolio" sub="Coverage of therapeutic classes in Tanzania">
      <Tabs items={tabs} current={tab} />
      <Flash sp={sp} />
      {tab === 'coverage' && (<>
        <div className="grid g3">
          <div className="card tight stack" style={{ gap: 6 }}><span className="lbl">TMDA list coverage</span><span className="score"><b className="num">{myScore}%</b></span>
            <span className="note">Share of official TMDA list molecules you carry in your classes</span></div>
          <div className="card tight stack" style={{ gap: 6 }}><span className="lbl">Molecules listed</span>
            <span className="score"><b className="num">{d.items.length}</b></span></div>
          <div className="card tight stack" style={{ gap: 6 }}><span className="lbl">vs country average</span>
            <span className="score sm"><b>{d.items.length === 0 ? '—' : myScore >= avgScore ? 'Above' : 'Below'}</b></span>
            <span className="note num">Distributor average {avgScore}%</span></div>
        </div>
        <div className="split">
          <section className="card">
            <div className="card-h"><h2>Essential molecules covered, by class</h2></div>
            <div className="bars">{d.coverage.map((c) => (
              <Bar key={c.category} label={c.category} value={c.covered} max={c.n} right={`${c.covered} of ${c.n} · ${c.n - c.covered} missing`} />))}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <Link className="btn btn-blue btn-sm" href={`/requests/new?missing=${encodeURIComponent(yourCats.map((c) => c.category).slice(0, 3).join('|'))}`}>Add missing to a request</Link>
            </div>
            <p className="note" style={{ marginTop: 12 }}>Coverage is measured against the {OFFICIAL_LIST()}.</p>
          </section>
          <div className="stack">
            <section className="card">
              <div className="card-h"><h2>Your molecules</h2><Link className="btn-link" href="/search">Add</Link></div>
              {d.items.length === 0 && <Empty>No molecules yet. Search and add them from the molecule page, or send us your catalogue.</Empty>}
              <div className="stack" style={{ gap: 6, maxHeight: 420, overflowY: 'auto' }}>{d.items.map((m) => (
                <div key={m.id} className="between"><Link href={`/molecule/${m.id}`}>{m.inn}</Link>
                  <form action={togglePortfolio}><input type="hidden" name="molecule_id" value={m.id} /><input type="hidden" name="return" value="/portfolio" />
                    <button className="btn-link small" type="submit" aria-label={`Remove ${m.inn}`}>Remove</button></form></div>))}</div>
            </section>
            {paid ? (
              <section className="card">
                <div className="card-h"><h2>Channels you cannot reach</h2></div>
                <p className="note" style={{ marginBottom: 10 }}>Hospital-level and programme molecules in your classes that you do not carry.</p>
                <div className="stack" style={{ gap: 6 }}>{d.unreachable.map((m) => (
                  <Link key={m.id} href={`/molecule/${m.id}`} className="between"><span>{m.inn}</span>
                    <span className="tiny muted">{m.channel_flag === 'programme' ? 'Programme' : levelLabel(m.facility_level)}</span></Link>))}</div>
              </section>
            ) : <Locked title="Channels you cannot reach">Sales channels and clinical requirements you miss because of the gaps.</Locked>}
          </div>
        </div>
      </>)}
      {tab === 'sourced' && (<>
        <div className="grid g4">
          <div className="tile t-white"><span className="k">Products sourced through Nazryx</span><span className="v num">{d.sourced.length}</span></div>
          <div className="tile t-blue"><span className="k">In registration</span><span className="v num">{d.sourced.filter((x) => x.stage === 'Registration').length}</span></div>
          <div className="tile t-mint"><span className="k">Shipments moving</span>
            <span className="v num">{d.sourced.filter((x) => x.stage === 'Shipment' && !['Delivered', 'Cancelled'].includes(x.status)).length}</span></div>
          <div className="tile t-peach"><span className="k">Documents still missing</span>
            <span className="v num">{d.sourced.filter((x) => x.stage === 'Shipment' && x.status !== 'Cancelled').reduce((a, x) => a + SHIPMENT_DOCS.length - (x.docs as any[]).filter((y) => y.ready).length, 0)}</span></div>
        </div>
        {d.sourced.length === 0 ? (
          <section className="card stack" style={{ alignItems: 'flex-start' }}>
            <Empty>Products you source through Nazryx appear here once you accept a quote: supplier terms, dossier readiness and every shipment.</Empty>
            <div className="row"><Link className="btn btn-blue btn-sm" href="/requests">See your requests</Link>
              <Link className="btn btn-ghost btn-sm" href="/market/whitespace">Find open molecules</Link></div>
          </section>
        ) : d.sourced.map((x) => (
          <section key={x.request_id} className="card">
            <div className="card-h" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div><h2>{x.molecule}</h2>
                <span className="sub2">{[x.supplier_name, x.supplier_country, x.price != null ? `${x.currency} ${Number(x.price).toFixed(2)}${x.unit ? ' per ' + x.unit : ''}` : null,
                  x.lead_time_weeks ? `${x.lead_time_weeks} weeks lead time` : null].filter(Boolean).join(' · ')}</span></div>
              <div className="row"><StagePill stage={x.stage} /><Link className="btn btn-ghost btn-sm" href={`/requests/${x.request_id}`}>Open</Link></div>
            </div>
            <QuoteTerms q={x} />
            <div className="grid g2" style={{ marginTop: 14 }}>
              <div className="stack" style={{ gap: 8 }}><span className="lbl">Dossier readiness</span>
                <DossierReadiness be={x.be_status} items={x.ditems} compact /></div>
              <div className="stack" style={{ gap: 8 }}><span className="lbl">Shipment{x.order_id ? ` #${x.order_id}` : ''}</span>
                {x.stage === 'Shipment' && x.status ? <ShipmentTrack status={x.status} eta={x.eta} docs={x.docs} /> : <span className="note">Starts once the product is registered.</span>}</div>
            </div>
          </section>))}
      </>)}
      {tab === 'suppliers' && (
        <div className="split">
          <section className="card">
            <div className="card-h"><h2>Your suppliers</h2>
              <span className="note">{d.suppliers.length} suppliers listed, covering {d.items.filter((m) => supplied.has(m.id)).length} of your {d.items.length} molecules</span></div>
            {d.suppliers.length === 0 && <Empty>List the suppliers you already buy from. Only you can see this list.</Empty>}
            <div className="stack" style={{ gap: 10 }}>{d.suppliers.map((s) => (
              <div key={s.id} className="between" style={{ alignItems: 'flex-start' }}>
                <div><b>{s.name}</b><div className="sub2">{s.names || 'No molecules linked'}</div></div>
                <form action={deleteCustomerSupplier}><input type="hidden" name="id" value={s.id} /><button className="btn-link small" type="submit">Remove</button></form>
              </div>))}</div>
            <div style={{ marginTop: 16 }}>
              {paid ? (
                <div className="stack" style={{ gap: 6 }}>
                  <h3>Single-source risk</h3>
                  <p className="note">{d.items.filter((m) => counts.get(m.id) === 1).length} molecules rely on one supplier; {d.items.filter((m) => !counts.get(m.id)).length} have none listed.</p>
                  <p className="small">{d.items.filter((m) => counts.get(m.id) === 1).map((m) => m.inn).join(', ')}</p>
                </div>
              ) : <Locked title="Single-source risk and overlap">See which molecules depend on one supplier.</Locked>}
            </div>
          </section>
          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Add supplier list</h2>
            <form action={addCustomerSupplier} className="stack">
              <div className="field"><label htmlFor="sname">Supplier name</label><input className="input" id="sname" name="name" required /></div>
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="lbl">Molecules they supply</legend>
                <div className="stack" style={{ gap: 4, maxHeight: 240, overflowY: 'auto' }}>{d.items.map((m) => (
                  <label key={m.id} className="row small" style={{ gap: 8 }}><input type="checkbox" name="molecule_ids" value={m.id} />{m.inn}</label>))}</div>
              </fieldset>
              <button className="btn btn-blue btn-sm" type="submit">Add supplier</button>
            </form>
          </section>
        </div>
      )}
      {tab === 'benchmark' && (
        <section className="card stack">
          <div className="card-h"><h2>You against Tanzanian distributors</h2><span className="pill">{COVERAGE_NOTE}</span></div>
          <div className="grid g2">
            <div className="stack" style={{ gap: 4 }}><span className="lbl">Your coverage</span><span className="score"><b className="num">{myScore}%</b></span></div>
            <div className="stack" style={{ gap: 4 }}><span className="lbl">Distributor average</span><span className="score"><b className="num">{avgScore}%</b></span></div>
          </div>
          {paid ? (<>
            <div className="legend"><span><i style={{ background: 'var(--blue)' }} />You</span><span><i style={{ background: 'var(--pastel-peach-ink)' }} />Average distributor</span></div>
            <div className="bars">{d.peers.map((p) => {
              const mine = d.coverage.find((c) => c.category === p.category)?.covered ?? 0;
              return <Bar key={p.category} label={p.category} value={mine} second={Math.round(p.avg_cov)} max={p.n} right={`${mine} vs ${Math.round(p.avg_cov)} of ${p.n}`} />;
            })}</div>
            <h3>Closest peers by shared molecules</h3>
            <div className="stack" style={{ gap: 6 }}>{d.topPeers.map((p) => (
              <Link key={p.id} href={`/company/${p.id}`} className="between"><span>{title(p.display_name)}</span><span className="small muted num">{p.shared} shared</span></Link>))}</div>
          </>) : <Locked title="Peer detail by class">Class-by-class comparison and your closest peers.</Locked>}
        </section>
      )}
    </Shell>
  );
}
