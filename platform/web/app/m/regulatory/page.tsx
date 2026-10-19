import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Empty, PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { canUse, tierIn, countryName, productClass, displayClass } from '@/lib/mfr';
import { DEVICE_REQ_SQL, REQ_SQL, byTopic, forProduct, type Requirement } from '@/lib/regulatory';
import { isDevice } from '@/lib/segments';

export const metadata = { title: 'Regulatory' };

// What a market requires: for every product (route, dossier, GMP, labels, marking ...), then for each of the
// manufacturer's products (bioequivalence, sterile, controlled, biological ...). Kept by the Nazryx regulatory team.
export default async function MfrRegulatory({ searchParams }: { searchParams: Promise<{ market?: string; product?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, primary_market, sample_product_id from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(prof?.target_countries);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const reqs = await rows(db, REQ_SQL, [market]) as Requirement[];
    const products = await rows(db, `select p.id, p.name, p.dosage_form, p.use_group, p.kind, p.molecule_id, coalesce(p.atc, '') as atc, m.inn, m.category
        from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by coalesce(m.inn, p.name)`, [u.id]);
    const routes = await rows(db, `select key, label, description, months_low, months_high, fee_usd_low, fee_usd_high, eligibility
        from country_routes where country = $1 and scope = 'medicine' order by sort`, [market]);
    // medical devices follow their own rules: shown for the user's device products, and as their own section
    const devReqs = await rows(db, DEVICE_REQ_SQL, [market]) as Requirement[];
    const devRoutes = await rows(db, `select key, label, description, months_low, months_high, fee_usd_low, fee_usd_high, eligibility
        from country_routes where country = $1 and scope = 'device' order by sort`, [market]);
    const checked = (await one(db, `select max(checked) as d from reg_requirements where country = $1 and status = 'published' and scope = 'medicine'`, [market]))?.d;
    // the regulator's latest notices (in English), those naming one of the user's molecules first
    const news = await rows(db, `select n.id, coalesce(n.title_en, n.title) as title, n.url, n.found_at,
        exists (select 1 from mfr_products p where p.user_id = $2 and p.molecule_id = any(n.molecule_ids)) as mine
        from reg_news n where n.country = $1 and not n.baseline order by mine desc, n.found_at desc limit 8`, [market, u.id]);
    return { targets, market, reqs, products, routes, checked, news, devReqs, devRoutes, sample: prof?.sample_product_id as number | null };
  });
  const m = d.market;
  const general = d.reqs.filter((r) => r.applies === 'all');
  const reqs: Requirement[] = d.reqs;
  const perProduct = d.products.map((p) => isDevice(p)
    ? { ...p, cls: displayClass(p), device: true, extra: forProduct(d.devReqs, { ...p, category: productClass(p) }) as Requirement[] }
    : { ...p, cls: displayClass(p), device: false, extra: forProduct(reqs, { ...p, category: productClass(p) }) as Requirement[] });
  const hasDevices = perProduct.some((p) => p.device);
  const withExtra = perProduct.filter((p) => p.extra.length > 0);
  const open = canUse(tierIn(u, m), 'requirements');
  const focus = sp.product ? perProduct.find((p) => String(p.id) === sp.product) : undefined;
  const fullRoute = d.routes.find((r) => r.key === 'full') ?? d.routes[0];
  const fastest = [...d.routes].filter((r) => r.months_low != null).sort((a, b) => a.months_low - b.months_low)[0];
  const usd = (lo: string | null, hi: string | null) => lo == null ? '—' : `$${Number(lo).toLocaleString('en')}${hi && hi !== lo ? `–${Number(hi).toLocaleString('en')}` : ''}`;
  const WHO: Record<string, string> = { all: 'Any product', sra_or_pq: 'Approved by a strict regulator or WHO-prequalified', eaeu: 'Filed under EAEU rules', eac: 'Filed through the EAC joint procedure' };

  return (
    <Shell user={u} title="Regulatory" sub={`${countryName(m)}: what it takes to register, and to stay registered`}
      actions={<Link className="btn btn-blue btn-sm" href="/m/services/dossier_review">Check my dossier</Link>}>
      <MarketPicker u={u} targets={d.targets} current={m} path="/m/regulatory" />

      {d.reqs.length === 0 ? (hasData(m) ? <Empty>Our regulatory team is writing up {countryName(m)}. Ask us anything in the meantime.</Empty> : <AgencyMarket code={m} />) : (<>
        <div className="grid g3">
          <div className="tile t-blue"><span className="k">For every product</span><span className="v num">{general.length}</span><span className="small">requirements in {countryName(m)}</span></div>
          <div className="tile t-peach"><span className="k">Your products with extra steps</span><span className="v num">{withExtra.length}</span>
            <span className="small">of {perProduct.length} in your catalogue</span></div>
          <div className="tile t-mint"><span className="k">Standard route</span>
            {fullRoute?.months_low != null ? <span className="v num">{fullRoute.months_low}–{fullRoute.months_high} mo</span> : null}
            <span className="small">{fullRoute ? `${fullRoute.label}${fastest && fastest !== fullRoute ? ` · fastest: ${fastest.label}, ${fastest.months_low}–${fastest.months_high} months` : ''}`
              : general.find((r) => r.topic === 'Route')?.body ?? 'Confirmed for your product when we review it.'}</span></div>
        </div>

        <section className="card stack">
          <div className="card-h"><div><h2>For your products</h2><p className="note">What applies on top of the market&rsquo;s general requirements, product by product.</p></div></div>
          {perProduct.length === 0 ? <Empty>Add your products and their own requirements show up here.</Empty> : !open && d.sample == null ? (
            <PlanLock need="access" title={`${withExtra.length} of your products have their own requirements`} u={u} market={m}>
              Bioequivalence, sterile products, controlled medicines, biologicals: what each of your products needs in {countryName(m)}.
            </PlanLock>
          ) : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Product</th><th>Extra requirements</th></tr></thead>
              <tbody>{perProduct.map((p) => {
                const shown = open || p.id === d.sample;
                return (
                  <tr key={p.id} id={`p${p.id}`} style={focus?.id === p.id ? { background: 'var(--pastel-blue)' } : undefined}>
                    <td style={{ width: '34%' }}><Link href={`/m/products/${p.id}?market=${m}`}><b>{p.inn ?? p.name}</b></Link>
                      <div className="sub2">{[p.inn ? p.name : null, p.cls].filter(Boolean).join(' · ')}</div>
                      {p.device && <span className="pill blue" style={{ fontSize: 12 }}>Medical device</span>}</td>
                    <td>{!shown ? <PlanLock compact need="access" title="Locked" u={u} market={m} />
                      : p.extra.length === 0 ? <span className="muted small">Only the general requirements</span> : (
                        <details open={focus?.id === p.id}>
                          <summary className="row" style={{ gap: 6, cursor: 'pointer' }}>{p.extra.map((r: Requirement) => <span key={r.id} className="pill peach">{r.title}</span>)}</summary>
                          <div className="stack" style={{ gap: 6, marginTop: 8 }}>{p.extra.map((r: Requirement) => (
                            <div key={r.id} className="small"><b>{r.title}</b> <span className="muted">· {r.topic}</span><div>{r.body}</div></div>))}</div>
                        </details>)}</td>
                  </tr>);
              })}</tbody></table></div>)}
        </section>

        {d.routes.length > 0 && (
          <section className="card stack">
            <div className="card-h"><div><h2>Routes to registration</h2><p className="note">Realistic time from filing to approval, and the official fees per product.</p></div></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Route</th><th className="hide-m">Who can use it</th><th className="r">Time</th><th className="r">Official fees</th></tr></thead>
              <tbody>{d.routes.map((r) => (
                <tr key={r.key}><td><b>{r.label}</b><div className="sub2">{r.description}</div></td>
                  <td className="small hide-m">{WHO[r.eligibility] ?? r.eligibility}</td>
                  <td className="r num">{r.months_low != null ? `${r.months_low}–${r.months_high} months` : '—'}</td>
                  <td className="r num">{usd(r.fee_usd_low, r.fee_usd_high)}</td></tr>))}</tbody></table></div>
          </section>)}

        {(d.devRoutes.length > 0 || d.devReqs.length > 0) && (
          <section className="card stack" id="devices">
            <div className="card-h"><div><h2>Medical devices in {countryName(m)}</h2>
              <p className="note">Eye-surgery viscoelastics, joint injections, nasal saline and lubricants registered as devices follow device rules{hasDevices ? ', which apply to your products marked Medical device above' : ''}.</p></div></div>
            {d.devRoutes.length > 0 && (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Route</th><th className="hide-m">Who can use it</th><th className="r">Time</th><th className="r">Official fees</th></tr></thead>
                <tbody>{d.devRoutes.map((r) => (
                  <tr key={r.key}><td><b>{r.label}</b><div className="sub2">{r.description}</div></td>
                    <td className="small hide-m">{r.eligibility === 'sra_or_pq' ? 'Approved elsewhere first (CE, FDA or similar)' : 'Any device'}</td>
                    <td className="r num">{r.months_low != null ? `${r.months_low}–${r.months_high} months` : '—'}</td>
                    <td className="r num">{usd(r.fee_usd_low, r.fee_usd_high)}</td></tr>))}</tbody></table></div>)}
            {open || hasDevices ? <div className="grid g2">{byTopic(d.devReqs.filter((r) => r.applies === 'all')).map(([topic, list]) => (
              <div key={topic} className="stack" style={{ gap: 6 }}><span className="lbl">{topic}</span>
                {list.map((r) => <div key={r.id}><b>{r.title}</b><div className="small muted">{r.body}</div></div>)}</div>))}</div>
              : <PlanLock need="access" title="Every device requirement in this market" u={u} market={m} />}
          </section>)}

        {d.news.length > 0 && (
          <section className="card stack">
            <h2>Latest from the regulator</h2>
            {d.news.map((n, i) => (
              <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer" className="between small"
                style={{ borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 8 : 0, gap: 12, textDecoration: 'none', color: 'inherit' }}>
                <span style={{ minWidth: 0 }}>{n.title}{n.mine && <span className="pill blue" style={{ marginLeft: 6 }}>Your product</span>}</span>
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(n.found_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ↗</span>
              </a>))}
          </section>)}

        <div className="grid g2">{byTopic(general).map(([topic, list]) => (
          <section key={topic} className="card stack" style={{ gap: 8 }}>
            <span className="lbl">{topic}</span>
            {list.map((r) => <div key={r.id}><b>{r.title}</b><div className="small muted">{r.body}</div></div>)}
          </section>))}</div>
        <p className="note">Kept current by the Nazryx regulatory team{d.checked ? `, last checked ${new Date(d.checked).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}` : ''}. Before anything is filed, we confirm every point for your product.</p>
      </>)}
    </Shell>
  );
}
