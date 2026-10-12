import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Empty, PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { canUse, tierIn, countryName, productClass } from '@/lib/mfr';
import { REQ_SQL, byTopic, forProduct, type Requirement } from '@/lib/regulatory';

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
    const products = await rows(db, `select p.id, p.name, p.dosage_form, coalesce(p.atc, '') as atc, m.inn, m.category
        from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by coalesce(m.inn, p.name)`, [u.id]);
    return { targets, market, reqs, products, sample: prof?.sample_product_id as number | null };
  });
  const m = d.market;
  const general = d.reqs.filter((r) => r.applies === 'all');
  const reqs: Requirement[] = d.reqs;
  const perProduct = d.products.map((p) => ({ ...p, cls: productClass(p), extra: forProduct(reqs, { ...p, category: productClass(p) }) as Requirement[] }));
  const withExtra = perProduct.filter((p) => p.extra.length > 0);
  const open = canUse(tierIn(u, m), 'requirements');
  const focus = sp.product ? perProduct.find((p) => String(p.id) === sp.product) : undefined;

  return (
    <Shell user={u} title="Regulatory" sub={`${countryName(m)}: what it takes to register, and to stay registered`}
      actions={<Link className="btn btn-blue btn-sm" href="/m/services/dossier_review">Check my dossier</Link>}>
      <MarketPicker u={u} targets={d.targets} current={m} path="/m/regulatory" />

      {d.reqs.length === 0 ? (hasData(m) ? <Empty>Our regulatory team is writing up {countryName(m)}. Ask us anything in the meantime.</Empty> : <AgencyMarket code={m} />) : (<>
        <div className="grid g3">
          <div className="tile t-blue"><span className="k">For every product</span><span className="v num">{general.length}</span><span className="small">requirements in {countryName(m)}</span></div>
          <div className="tile t-peach"><span className="k">Your products with extra steps</span><span className="v num">{withExtra.length}</span>
            <span className="small">of {perProduct.length} in your catalogue</span></div>
          <div className="tile t-mint"><span className="k">Route</span>
            <span className="small" style={{ fontSize: 14 }}>{general.find((r) => r.topic === 'Route')?.body ?? 'Confirmed for your product when we review it.'}</span></div>
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
                      <div className="sub2">{[p.inn ? p.name : null, p.cls].filter(Boolean).join(' · ')}</div></td>
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

        <div className="grid g2">{byTopic(general).map(([topic, list]) => (
          <section key={topic} className="card stack" style={{ gap: 8 }}>
            <span className="lbl">{topic}</span>
            {list.map((r) => <div key={r.id}><b>{r.title}</b><div className="small muted">{r.body}</div></div>)}
          </section>))}</div>
        <p className="note">Kept current by the Nazryx regulatory team. Before anything is filed, we confirm every point for your product.</p>
      </>)}
    </Shell>
  );
}
