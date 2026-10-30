import Link from 'next/link';
import Shell from '@/components/Shell';
import MoleculePicker from '@/components/MoleculePicker';
import { loadLive, dataMarkets, targetMarkets } from '@/components/MarketPicker';
import { ConfidenceChip, Empty, PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { MARKET_CURRENCY, NEIGHBOURS, PRICE_SQL, packKind, packOf, priceFor, type MoleculePrice } from '@/lib/prices';

export const metadata = { title: 'Pricing' };

const STEPS: [string, string, string][] = [
  ['freight', 'Freight and insurance', 'to the port or airport of entry'],
  ['duty', 'Duty and border fees', 'import duty, inspection, port handling'],
  ['distributor', 'Distributor margin', 'the importer who holds the registration and sells to pharmacies'],
  ['pharmacy', 'Pharmacy margin', 'retail mark-up'],
  ['vat', 'VAT', 'where medicines are not exempt'],
];
type Costs = Record<string, number>;

// Your ex-works price, landed and marked up the way each market does it, against what the shelf pays today, in every
// market at once. A market with no shelf price read borrows its nearest neighbour's (marked as an estimate) or the target
// you type. Packs are counted the way the form is sold: tablets per box, ml per bottle, vials per box.
export default async function Simulator({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const num = (v?: string) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n >= 0 ? n : null; };
  const exw = num(sp.exw), units = num(sp.units), aim = num(sp.shelf);
  const over: Partial<Costs> = Object.fromEntries(STEPS.map(([k]) => [k, num(sp[k])]).filter(([, v]) => v != null).map(([k, v]) => [k, (v as number) / 100]));
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.id]);
    const markets = dataMarkets(targetMarkets(prof?.target_countries, u.mfr_markets));
    const mine = await rows(db, `select m.id, m.inn, array_remove(array_agg(distinct p.dosage_form), null) as forms, count(*)::int as n
        from mfr_products p join molecules m on m.id = p.molecule_id where p.user_id = $1 group by m.id, m.inn order by m.inn`, [u.id]);
    const molecule = mine.find((x) => x.id === Number(sp.molecule))
      ?? (Number(sp.molecule) ? await one(db, 'select id, inn, array[]::text[] as forms, 0 as n from molecules where id = $1', [Number(sp.molecule)]) : null) ?? mine[0] ?? null;
    const prices = molecule ? await rows(db, `${PRICE_SQL} where molecule_id = $1`, [molecule.id]) as MoleculePrice[] : [];
    const costs = Object.fromEntries((await rows(db, 'select * from market_costs where country = any($1)', [markets])).map((c) => [c.country, c]));
    const fx: Record<string, number> = Object.fromEntries((await rows(db, 'select currency, per_usd::float as r from fx_rates')).map((x) => [x.currency, x.r]));
    return { markets, mine, molecule, prices, costs, fx };
  });
  const mol = d.molecule;
  const forms: string[] = (mol?.forms ?? []).filter(Boolean);
  const form = forms.includes(sp.form ?? '') ? sp.form! : forms[0] ?? null;
  const kind = packKind(form);
  const money = (v: number) => (v < 1 ? v.toFixed(3) : fmtMoney(v));
  const focusCode = sp.market ?? null;

  const row = (c: string) => {
    const open = canUse(tierIn(u, c), 'market');
    const own = priceFor(d.prices.find((x) => x.country === c), form);
    let p: MoleculePrice | null = own, from: string | null = null;
    if (!p) for (const n of NEIGHBOURS[c] ?? []) { const q = priceFor(d.prices.find((x) => x.country === n), form); if (q) { p = { ...q, confidence: 'estimated' }; from = n; break; } }
    const cur = MARKET_CURRENCY[c]; const rate = d.fx[cur] ?? null;                         // local per USD
    const base = d.costs[c] ?? {};
    const shares: Costs = Object.fromEntries(STEPS.map(([k]) => [k, over[k] ?? Number(base[k] ?? 0)]));
    const chain = STEPS.reduce((m, [k]) => m * (1 + shares[k]), 1);
    const pack = units ?? (p && kind.liquid && packOf(p) > 1 ? packOf(p) : kind.size);
    // the market's shelf price per unit in USD: read here, borrowed from a neighbour, or the target typed in
    const ratio = p && Number(p.unit_price) ? Number(p.unit_usd) / Number(p.unit_price) : null;
    const unitUsd = p ? Number(p.unit_usd) : aim != null ? aim / pack : null;
    const typed = !p && aim != null;
    const loUsd = p && ratio ? Number(p.lo ?? p.unit_price) * ratio : unitUsd, hiUsd = p && ratio ? Number(p.hi ?? p.unit_price) * ratio : unitUsd;
    const shelfUsd = exw != null ? (exw / pack) * chain : null;                            // your price on the shelf, USD per unit
    const target = unitUsd != null ? (unitUsd / chain) * pack : null;                      // the most ex-works per pack that still meets the shelf
    const where = shelfUsd == null || unitUsd == null ? null
      : shelfUsd <= loUsd! ? ['mint', 'Cheapest'] : shelfUsd <= unitUsd ? ['mint', 'Competitive'] : shelfUsd <= hiUsd! ? ['peach', 'Premium'] : ['peach', 'Above market'];
    return { c, open, p, from, typed, cur, rate, shares, chain, pack, unitUsd, loUsd, hiUsd, shelfUsd, target, where };
  };
  const table = d.markets.map(row);
  const focus = table.find((r) => r.c === focusCode) ?? table.find((r) => r.open && r.p && !r.from) ?? table.find((r) => r.open && r.unitUsd != null) ?? table[0];
  const packWord = (r: { pack: number }) => kind.liquid ? `${money(r.pack)} ${kind.unit}` : `${r.pack} ${kind.unit}`;
  const keep = Object.fromEntries(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]);
  const L = { pick: t('Molecule'), type: t('Type to search your products'), nothing: t('No product matches'), more: t('{n} more: keep typing') };
  return (
    <Shell user={u} help={t('Start from the shelf price in a market and work back through the pharmacy, distributor, duty and freight margins to the price you can sell at. Change any margin to see the effect.')} title={t('Pricing')} sub={t('Your ex-works price against every shelf, landed and marked up the way each market does it')}>
      <form method="get" className="card tight stack" style={{ gap: 10 }} aria-label={t('Pricing inputs')}>
        <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
          <div style={{ flex: '2 1 240px', minWidth: 0 }}>
            {d.mine.length === 0 && !mol ? <label className="small">{L.pick}<input className="input" disabled value={t('Add products to pick one')} readOnly /></label>
              : <MoleculePicker items={[...d.mine, ...(mol && !d.mine.some((m) => m.id === mol.id) ? [mol] : [])]} value={mol?.id ?? null} label={L.pick} placeholder={L.type} nothing={L.nothing} more={L.more} />}
          </div>
          {forms.length > 1 && (
            <label className="small" style={{ flex: '1 1 160px' }}>{t('Form')}
              <select className="input" name="form" defaultValue={form ?? ''}>{forms.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>)}
          <label className="small" style={{ flex: '1 1 150px' }}>{t('Your ex-works price (USD per pack)')}
            <input className="input" name="exw" type="number" step="any" min="0" defaultValue={exw ?? ''} placeholder="e.g. 2.40" /></label>
          <label className="small" style={{ flex: '1 1 140px' }}>{t(kind.label)}
            <input className="input" name="units" type="number" step="any" min="0" defaultValue={units ?? ''} placeholder={String(kind.size)} /></label>
          <button className="btn btn-blue btn-sm" type="submit">{t('Simulate')}</button>
        </div>
        <details open={aim != null || Object.keys(over).length > 0}>
          <summary className="small muted" style={{ cursor: 'pointer' }}>{t('More: a target shelf price where none is read, and the margins')}</summary>
          <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
            <label className="small" style={{ flex: '1 1 200px' }}>{t('Target shelf price (USD per pack, optional)')}
              <input className="input" name="shelf" type="number" step="any" min="0" defaultValue={aim ?? ''} placeholder={t('used where no shelf price is read')} /></label>
            {STEPS.map(([k, l]) => <label key={k} className="small" style={{ flex: '1 1 120px' }}>{t(l)} %
              <input className="input" name={k} type="number" step="any" min="0" max="500" defaultValue={over[k] != null ? Math.round(over[k]! * 1000) / 10 : ''} placeholder={t('market')} /></label>)}
          </div>
        </details>
      </form>
      {!mol ? <Empty action={{ href: '/m/products', label: t('My products') }}>{t('Add your products first; the simulator prices each of your molecules against every market.')}</Empty> : (<>
        <section className="card stack">
          <div className="card-h"><div><h2>{t('{molecule} across your markets', { molecule: mol.inn })}</h2>
            <p className="note">{form ? `${form} · ` : ''}{exw != null ? t('At ${exw} ex-works per pack of {pack}, landed and marked up the way each market does it.', { exw: money(exw), pack: focus ? packWord(focus) : `${kind.size} ${kind.unit}` })
              : t('Enter your ex-works price to see where it lands on each shelf. Without it: the most you could charge per pack of {pack} and still meet the market median.', { pack: focus ? packWord(focus) : `${kind.size} ${kind.unit}` })}</p></div></div>
          <div className="tbl-wrap" tabIndex={0}><table className="tbl">
            <thead><tr><th>{t('Market')}</th><th className="r">{t('Shelf median per pack')}</th><th className="r hide-m">{t('Range')}</th><th className="r">{t('Max ex-works per pack')}</th>
              {exw != null && <><th className="r">{t('Your shelf price')}</th><th>{t('Position')}</th></>}<th className="r hide-m">{t('Mark-ups')}</th></tr></thead>
            <tbody>{table.map((r) => (
              <tr key={r.c} className={focus?.c === r.c ? 'row-on' : ''}>
                <td><Link href={`/m/simulator?${new URLSearchParams({ ...keep, market: r.c, molecule: String(mol.id) }).toString()}`}><b>{t(countryName(r.c))}</b></Link>
                  <div className="sub2">{t('per pack of {pack}', { pack: packWord(r) })}</div></td>
                {!r.open ? <td colSpan={exw != null ? 6 : 4}><PlanLock compact need="data" title={t('{market} prices', { market: t(countryName(r.c)) })} u={u} market={r.c} /></td>
                  : r.unitUsd == null ? <td colSpan={exw != null ? 4 : 2} className="small muted">{t('No shelf price read here or nearby yet')}</td> : (<>
                  <td className="r"><span className="num">${money(r.unitUsd * r.pack)}</span> {r.p ? <ConfidenceChip level={r.p.confidence} /> : <span className="pill">{t('your target')}</span>}
                    <div className="sub2">{r.from ? t('estimate from {market}', { market: t(countryName(r.from)) }) : r.p && r.rate ? `${r.cur} ${money(r.unitUsd * r.rate * r.pack)}` : r.typed ? t('typed above') : ''}</div></td>
                  <td className="r hide-m small num">{r.loUsd != null && r.hiUsd != null && r.hiUsd !== r.loUsd ? `$${money(r.loUsd * r.pack)}–${money(r.hiUsd * r.pack)}` : '—'}</td>
                  <td className="r"><b className="num">${money(r.target!)}</b>{exw != null && <div className="sub2">{r.target! >= exw ? `+${Math.round(((r.target! - exw) / exw) * 100)}% ${t('headroom')}` : `${Math.round(((r.target! - exw) / exw) * 100)}%`}</div>}</td>
                  {exw != null && <><td className="r num">${money(r.shelfUsd! * r.pack)}{r.rate && <div className="sub2">{r.cur} {money(r.shelfUsd! * r.rate * r.pack)}</div>}</td>
                    <td><span className={`pill ${r.where![0]}`}>{t(r.where![1])}</span></td></>}
                </>)}
                {r.open && r.unitUsd == null && exw != null && <><td className="r num">${money(r.shelfUsd! * r.pack)}{r.rate && <div className="sub2">{r.cur} {money(r.shelfUsd! * r.rate * r.pack)}</div>}</td><td className="small muted">—</td></>}
                {r.open && <td className="r hide-m small muted num">×{r.chain.toFixed(2)}</td>}
              </tr>))}</tbody>
          </table></div>
          {table.some((r) => r.open && r.unitUsd == null) && <p className="note">{t('Markets without a shelf price: type a target shelf price under More above and the simulator works backwards from it; our team reads shelf prices there within a few days of a request.')}</p>}
          <p className="small muted">{t('Max ex-works: the price per pack at which, after every mark-up, the product sells at the shelf median. Mark-ups: the factor from ex-works to shelf. An estimate borrows the nearest market with a reading, converted at today’s rate.')}</p>
        </section>
        {focus && focus.open && (
          <section className="card stack">
            <div className="card-h"><div><h2>{t('Step by step in {market}', { market: t(countryName(focus.c)) })}</h2>
              <p className="note">{exw != null ? t('From ${exw} ex-works per pack of {pack} to the shelf.', { exw: money(exw), pack: packWord(focus) }) : t('Backwards from the shelf median to the most you can charge, per pack of {pack}.', { pack: packWord(focus) })}</p></div>
              <Link className="btn-link" href={`/m/market?market=${focus.c}`}>{t('Market')}</Link></div>
            {(() => {
              const perPack = exw ?? focus.target;
              if (perPack == null) return <Empty>{t('No shelf price for {name} in {market} yet; enter an ex-works price or a target shelf price to see the chain.', { name: mol.inn, market: t(countryName(focus.c)) })}</Empty>;
              let running = perPack;
              const steps = STEPS.map(([k, l, note]) => { const before = running; running = running * (1 + focus.shares[k]); return { k, l, note, share: focus.shares[k], before, after: running }; });
              return (<div className="tbl-wrap" tabIndex={0}><table className="tbl">
                <thead><tr><th>{t('Step')}</th><th className="r">{t('Share')}</th><th className="r">{t('USD per pack')}</th>{focus.rate && <th className="r hide-m">{focus.cur} {t('per pack')}</th>}</tr></thead>
                <tbody>
                  <tr><td><b>{t('Ex-works')}</b><div className="sub2">{t('your price, at the factory gate')}</div></td><td className="r"></td><td className="r num">${money(perPack)}</td>{focus.rate && <td className="r hide-m num">{money(perPack * focus.rate)}</td>}</tr>
                  {steps.map((s) => <tr key={s.k}><td>{t(s.l)}<div className="sub2">{t(s.note)}</div></td><td className="r num">{Math.round(s.share * 1000) / 10}%</td><td className="r num">${money(s.after)}<div className="sub2">+${money(s.after - s.before)}</div></td>{focus.rate && <td className="r hide-m num">{money(s.after * focus.rate)}</td>}</tr>)}
                  <tr><td><b>{t('On the shelf')}</b><div className="sub2">{focus.unitUsd != null ? `${focus.from ? t('estimate from {market}', { market: t(countryName(focus.from)) }) : focus.typed ? t('your target') : t('shelf median')}: $${money(focus.unitUsd * focus.pack)} ${t('per pack of {pack}', { pack: packWord(focus) })}` : ''}</div></td>
                    <td className="r small muted num">×{focus.chain.toFixed(2)}</td><td className="r num"><b>${money(running)}</b></td>{focus.rate && <td className="r hide-m num"><b>{money(running * focus.rate)}</b></td>}</tr>
                </tbody></table></div>);
            })()}
            <p className="small muted">{t('Shares are {market}’s typical ones, kept by our team from distributor terms and tariff schedules; override any of them above to test a deal. Shelf prices are read from pharmacies and official lists.', { market: t(countryName(focus.c)) })}</p>
          </section>)}
      </>)}
    </Shell>
  );
}
