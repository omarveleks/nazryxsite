import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Bar, ConfidenceChip, Empty, Flash, PlanLock } from '@/components/ui';
import { addToPipeline } from '@/app/actions/finder';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { usd } from '@/lib/prices';

export const metadata = { title: 'Company' };

// A company in a market: what it holds, when it came in, the classes it leads, who it works with, and its prices.
// Names open on Complete Market Access; the code is the same everywhere.
export default async function Company({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ market?: string; saved?: string; error?: string; cls?: string }> }) {
  const code = (await params).code.toUpperCase();
  const sp = await searchParams;
  if (!/^[0-9A-F]{8}$/.test(code)) notFound();
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.owner_id ?? u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const c = hasData(market) ? await one(db, 'select * from company_profile($1, $2)', [code, market]) : null;
    if (!c) return { targets, market, c: null, products: [] as any[], links: [] as any[], inPipe: false, rank: 0, of: 0 };
    const products = await rows(db, 'select * from company_products($1, $2)', [code, market]);
    const links = await rows(db, 'select * from company_links($1, $2)', [code, market]);
    const inPipe = Boolean(await one(db, 'select 1 as x from my_pipeline($1) where code = $2', [market, code]));
    const rk = await one(db, 'select * from company_rank($1, $2)', [code, market]);
    return { targets, market, c, products, links, inPipe, rank: rk?.rank ?? 0, of: rk?.of ?? 0 };
  });
  const m = d.market, name = t(countryName(m));
  const tier = tierIn(u, m), named = canUse(tier, 'distributors');
  const title = d.c?.name ?? `${d.c?.is_ltr ? t('Distributor') : t('Company')} ${code}`;
  const byClass = d.c ? Object.entries(d.products.reduce<Record<string, any[]>>((acc, p) => { const k = p.category ?? t('Class not set'); (acc[k] ??= []).push(p); return acc; }, {})).sort((a, b) => b[1].length - a[1].length) : [];
  const shownClass = sp.cls && byClass.some(([k]) => k === sp.cls) ? sp.cls : null;
  const list = shownClass ? d.products.filter((p) => (p.category ?? t('Class not set')) === shownClass) : d.products;
  const origins = d.c ? Object.entries(d.products.reduce<Record<string, number>>((acc, p) => { const k = p.made_in || t('Not stated'); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  return (
    <Shell user={u} title={title} sub={d.c ? [d.c.is_ltr ? t('Distributor') : d.c.is_manufacturer ? t('Manufacturer') : t('Registration holder'), d.c.home ? t(countryName(d.c.home) || d.c.home) : null, `${name}`].filter(Boolean).join(' · ') : name}
      crumb={<><Link href={`/m/partners?market=${m}`}>{t('Partners')}</Link> / {code}</>}
      actions={d.c && d.c.is_ltr ? (d.inPipe ? <Link className="pill mint" href={`/m/partners?market=${m}&tab=pipeline`}>{t('In your pipeline')}</Link>
        : <form action={addToPipeline}><input type="hidden" name="market" value={m} /><input type="hidden" name="code" value={code} /><input type="hidden" name="return" value={`/m/companies/${code}?market=${m}`} /><button className="btn btn-blue btn-sm" type="submit">{t('Shortlist')}</button></form>) : undefined}>
      <Flash sp={sp} />
      <MarketPicker u={u} targets={d.targets} current={m} path={`/m/companies/${code}`} />
      {!hasData(m) ? <AgencyMarket code={m} /> : !d.c ? <section className="card"><Empty>{t('No company with this code holds anything in {market}.', { market: name })}</Empty></section> : (<>
        {!named && <p className="note">{t('Names open on Complete Market Access; the code stays the same on every page.')} <Link href="/m/plan?want=access">{t('See the plans')}</Link></p>}
        <div className="grid g4">
          <div className="tile t-blue"><span className="k">{t('Registered products')}</span><span className="v num">{d.c.registrations}</span><span className="small">{d.rank ? t('number {r} of {n} in {market}', { r: d.rank, n: d.of, market: name }) : ''}</span></div>
          <div className="tile t-mint"><span className="k">{t('Molecules')}</span><span className="v num">{d.c.molecules}</span><span className="small">{t('{n} therapeutic classes', { n: d.c.classes })}</span></div>
          <div className="tile t-lav"><span className="k">{t('In the market since')}</span><span className="v num">{d.c.first_year ?? '—'}</span><span className="small">{d.c.latest_year ? t('latest registration {y}', { y: d.c.latest_year }) : ''}</span></div>
          <div className="tile t-peach"><span className="k">{t('New in two years')}</span><span className="v num">{d.c.recent ?? 0}</span><span className="small">{t('registrations')}</span></div>
        </div>
        <div className="split">
          <section className="card stack">
            <div className="card-h"><div><h2>{t('Portfolio in {market}', { market: name })}</h2><p className="note">{t('Every active registration this company holds, distributes or makes here. Yours are marked.')}</p></div>
              {shownClass && <Link className="btn-link" href={`/m/companies/${code}?market=${m}`}>{t('All classes')}</Link>}</div>
            <div className="row" style={{ gap: 6 }}>{byClass.slice(0, 10).map(([k, ps]) => <Link key={k} className={`pill ${shownClass === k ? 'solid' : ''}`} href={`/m/companies/${code}?market=${m}&cls=${encodeURIComponent(k)}`}>{t(k)} · {ps.length}</Link>)}</div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>{t('Brand')}</th><th>{t('Molecule')}</th><th className="hide-m">{t('Form')}</th><th className="hide-m">{t('Made in')}</th><th className="r">{t('Year')}</th><th className="r hide-m">{t('Shelf price')}</th></tr></thead>
              <tbody>{list.slice(0, 200).map((p) => (
                <tr key={p.id}><td><b>{p.brand || p.inn}</b>{p.role !== 'holder' && <div className="sub2">{t(p.role === 'maker' ? 'made by this company' : 'distributed by this company')}</div>}</td>
                  <td>{p.molecule_id ? <Link href={`/m/molecules/${p.molecule_id}?market=${m}`}>{p.inn}</Link> : p.inn}{p.mine && <span className="pill blue" style={{ marginLeft: 6, fontSize: 11 }}>{t('yours')}</span>}</td>
                  <td className="hide-m small">{p.form ?? ''}{p.strength ? ` · ${p.strength}` : ''}</td><td className="hide-m small">{p.made_in ?? ''}</td>
                  <td className="r small num">{p.reg_year ?? ''}</td>
                  <td className="r hide-m small num">{p.unit_usd != null && canUse(tier, 'market') ? `${usd(p.unit_usd)}/${p.unit}` : ''}</td></tr>))}</tbody>
            </table></div>
            {list.length > 200 && <p className="note">{t('Showing 200 of {n}.', { n: list.length })}</p>}
          </section>
          <div className="stack">
            <section className="card stack">
              <h2>{t('Where its products are made')}</h2>
              {origins.map(([k, n]) => <Bar key={k} label={k} value={n} max={origins[0][1]} right={String(n)} />)}
            </section>
            <section className="card stack">
              <h2>{d.c.is_ltr ? t('Manufacturers it carries') : t('Distributors carrying it')}</h2>
              {d.links.length === 0 ? <p className="note">{t('The register names no counterpart here.')}</p> : d.links.map((l) => (
                <Link key={l.code + l.role} href={`/m/companies/${l.code}?market=${m}`} className="between small"><span>{l.name ?? `${t(l.role === 'maker' ? 'Manufacturer' : 'Distributor')} ${l.code}`}</span><span className="num">{l.products}</span></Link>))}
              {!named && d.links.length > 0 && <PlanLock compact need="access" title={t('Names')} u={u} market={m} />}
            </section>
            <section className="card stack">
              <h2>{t('Against your catalogue')}</h2>
              <p className="small">{t('{n} of its molecules are also yours.', { n: new Set(d.products.filter((p) => p.mine).map((p) => p.molecule_id)).size })}
                {' '}{d.c.is_ltr ? t('A distributor that already sells your class knows the buyers; one that does not carry your molecule has a gap you can fill.') : t('A holder on the same molecules is a competitor to watch; its brands and prices are on each molecule page.')}</p>
              {d.c.is_ltr && <Link className="btn btn-ghost btn-sm" href={`/m/partners?market=${m}`} style={{ alignSelf: 'flex-start' }}>{t('Compare distributors')}</Link>}
            </section>
            <p className="note"><ConfidenceChip level="measured" /> {t('From the national register. Counts are registered products, not sales.')}</p>
          </div>
        </div>
      </>)}
    </Shell>
  );
}
