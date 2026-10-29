import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { TENDER_DOCS, bidScore, suggestBid, type Stats } from '@/lib/tenders';
import { PRICE_SQL, type MoleculePrice } from '@/lib/prices';

export const metadata = { title: 'Tender' };

const SOURCE: Record<string, string> = { kz_skpharm: 'SK-Pharmacy (single distributor)', tz_nest: 'NeST, Tanzania', ke_ppip: 'Public procurement portal, Kenya',
  uz_etender: 'UZEX e-tenders, Uzbekistan' };

// One tender: what is bought, by whom, how much and at what price, how it ended, and the official notice.
export default async function Tender({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    const tender = await one(db, 'select * from tenders where id = $1', [Number(id) || 0]);
    if (!t) return null;
    const mols = await rows(db, `select m.id, m.inn, (select p.id from mfr_products p where p.user_id = $2 and p.molecule_id = m.id limit 1) as product
        from molecules m where m.id = any($1) order by m.inn`, [tender.molecule_ids, u.id]);
    const stats = await one(db, 'select * from tender_stats($1)', [tender.id]) as Stats | null;
    // the manufacturer's own position: the median shelf price of its molecule here, worked back to a distributor's buying price
    const mineMol = mols.find((x) => x.product)?.id ?? null;
    const price = mineMol ? await one(db, `${PRICE_SQL} where molecule_id = $1 and country = $2`, [mineMol, tender.country]) as MoleculePrice | null : null;
    const costs = await one(db, 'select distributor, pharmacy, vat from market_costs where country = $1', [tender.country]);
    const myUnit = price && costs ? Number(price.unit_price) / ((1 + Number(costs.pharmacy)) * (1 + Number(costs.vat))) : null;
    return { tender, mols, stats, myUnit, mine: mols.some((x) => x.product) };
  });
  if (!d) notFound();
  const { tender, mols } = d;
  const sc = bidScore(d.stats, d.myUnit, d.mine, tender.stage === 'open'), bid = suggestBid(d.stats);
  const docs = TENDER_DOCS[tender.country] ?? TENDER_DOCS.TZ;
  const full = canUse(tierIn(u, tender.country), 'market');
  const at = (v: string | null) => (v ? fmtDate(v) : '—');
  return (
    <Shell user={u} title={tender.title_en ?? tender.title} crumb={<><Link href={`/m/tenders?market=${tender.country}`}>{t('Tenders')}</Link> / {countryName(tender.country)}</>}
      sub={`${tender.buyer_en ?? tender.buyer ?? 'Public buyer'} · ${SOURCE[tender.source] ?? tender.source}`}
      actions={full && tender.url ? <a className="btn btn-blue btn-sm" href={tender.url} target="_blank" rel="noopener noreferrer">{t('Official notice ↗')}</a> : undefined}>
      {!full ? <PlanLock need="data" title={t('Tender details')} u={u} market={tender.country}>{t('Quantity, price, result and the official notice for every medicine tender.')}</PlanLock> : (<>
        <div className="grid g4">
          <div className="tile t-blue"><span className="k">{t('Status')}</span><span className="v" style={{ fontSize: 22 }}>{tender.stage === 'open' ? 'Open' : tender.stage === 'awarded' ? 'Awarded' : 'Closed'}</span>
            <span className="small">{tender.bidders ? `${tender.bidders} ${tender.bidders === 1 ? 'bid' : 'bids'}` : ''}</span></div>
          <div className="tile t-mint"><span className="k">{t('Quantity')}</span><span className="v num" style={{ fontSize: 22 }}>{tender.quantity ? fmtMoney(tender.quantity) : '—'}</span><span className="small">{t('units')}</span></div>
          <div className="tile t-lav"><span className="k">{t('Unit price')}</span><span className="v num" style={{ fontSize: 22 }}>{tender.unit_price ? fmtMoney(tender.unit_price) : '—'}</span><span className="small">{tender.currency ?? ''}{tender.stage === 'awarded' ? '' : ' budget'}</span></div>
          <div className="tile t-peach"><span className="k">{t('Total value')}</span><span className="v num" style={{ fontSize: 22 }}>{tender.value ? fmtMoney(tender.value) : '—'}</span><span className="small">{tender.currency ?? ''}</span></div>
        </div>
        {(tender.title_en || tender.buyer_en) && <section className="card stack small">
          <span className="lbl">{t('Original text')}</span><div>{tender.title}</div>{tender.buyer && <div className="muted">{tender.buyer}</div>}
        </section>}
        <section className="card stack">
          <h2>{t('Dates')}</h2>
          <div className="grid g3 small"><div><span className="lbl">{t('Published')}</span><div>{at(tender.published)}</div></div>
            <div><span className="lbl">{t('Closing')}</span><div>{at(tender.closing)}</div></div><div><span className="lbl">{t('Awarded')}</span><div>{at(tender.awarded)}</div></div></div>
        </section>
        <div className="split">
          <section className="card stack">
            <div className="card-h"><h2>{t('Bid or pass')}</h2><span className={`pill ${sc.verdict === 'bid' ? 'mint' : sc.verdict === 'consider' ? 'blue' : ''}`}>{t({ bid: 'Bid', consider: 'Consider', pass: 'Pass', closed: 'Closed' }[sc.verdict] ?? sc.verdict)}</span></div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{sc.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            {bid && <p><b className="num">{bid.currency} {bid.price.toFixed(2)}</b> {t('per unit as a starting bid')}<span className="sub2" style={{ display: 'block' }}>{bid.basis}</span></p>}
            {d.myUnit != null && <p className="small muted">{t('Your reference: the median shelf price of your molecule here, worked back to what a distributor pays, is about {p} per unit.', { p: d.myUnit.toFixed(2) })}</p>}
          </section>
          <section className="card stack">
            <h2>{t('What a bid usually needs')}</h2>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{docs.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="note">{t('The notice itself rules; this is the usual list for {market}.', { market: t(countryName(tender.country)) })}</p>
          </section>
        </div>
        <section className="card stack">
          <h2>{t('Medicines in this tender')}</h2>
          {mols.length === 0 ? <p className="muted small">{t('Not matched to a molecule yet: read the official notice for the item list.')}</p>
            : <div className="row" style={{ gap: 6 }}>{mols.map((m) => m.product
              ? <Link key={m.id} className="pill blue" href={`/m/products/${m.product}?market=${tender.country}`}>{m.inn} · yours</Link>
              : <span key={m.id} className="pill">{m.inn}</span>)}</div>}
        </section>
        <section className="card between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span>{t('Want to bid, or supply a distributor who does? Our team checks eligibility, documents and timing.')}</span>
          <Link className="btn btn-blue btn-sm" href="/m/call?topic=market_entry">{t('Talk to us about this tender')}</Link>
        </section>
      </>)}
    </Shell>
  );
}
