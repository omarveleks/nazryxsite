import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { canUse, countryName, tierIn } from '@/lib/mfr';

export const metadata = { title: 'Tender' };

const SOURCE: Record<string, string> = { kz_skpharm: 'SK-Pharmacy (single distributor)', tz_nest: 'NeST, Tanzania', ke_ppip: 'Public procurement portal, Kenya',
  uz_etender: 'UZEX e-tenders, Uzbekistan' };

// One tender: what is bought, by whom, how much and at what price, how it ended, and the official notice.
export default async function Tender({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    const t = await one(db, 'select * from tenders where id = $1', [Number(id) || 0]);
    if (!t) return null;
    const mols = await rows(db, `select m.id, m.inn, (select p.id from mfr_products p where p.user_id = $2 and p.molecule_id = m.id limit 1) as product
        from molecules m where m.id = any($1) order by m.inn`, [t.molecule_ids, u.id]);
    return { t, mols };
  });
  if (!d) notFound();
  const { t, mols } = d;
  const full = canUse(tierIn(u, t.country), 'market');
  const at = (v: string | null) => (v ? fmtDate(v) : '—');
  return (
    <Shell user={u} title={t.title_en ?? t.title} crumb={<><Link href={`/m/tenders?market=${t.country}`}>Tenders</Link> / {countryName(t.country)}</>}
      sub={`${t.buyer_en ?? t.buyer ?? 'Public buyer'} · ${SOURCE[t.source] ?? t.source}`}
      actions={full && t.url ? <a className="btn btn-blue btn-sm" href={t.url} target="_blank" rel="noopener noreferrer">Official notice ↗</a> : undefined}>
      {!full ? <PlanLock need="data" title="Tender details" u={u} market={t.country}>Quantity, price, result and the official notice for every medicine tender.</PlanLock> : (<>
        <div className="grid g4">
          <div className="tile t-blue"><span className="k">Status</span><span className="v" style={{ fontSize: 22 }}>{t.stage === 'open' ? 'Open' : t.stage === 'awarded' ? 'Awarded' : 'Closed'}</span>
            <span className="small">{t.bidders ? `${t.bidders} ${t.bidders === 1 ? 'bid' : 'bids'}` : ''}</span></div>
          <div className="tile t-mint"><span className="k">Quantity</span><span className="v num" style={{ fontSize: 22 }}>{t.quantity ? fmtMoney(t.quantity) : '—'}</span><span className="small">units</span></div>
          <div className="tile t-lav"><span className="k">Unit price</span><span className="v num" style={{ fontSize: 22 }}>{t.unit_price ? fmtMoney(t.unit_price) : '—'}</span><span className="small">{t.currency ?? ''}{t.stage === 'awarded' ? '' : ' budget'}</span></div>
          <div className="tile t-peach"><span className="k">Total value</span><span className="v num" style={{ fontSize: 22 }}>{t.value ? fmtMoney(t.value) : '—'}</span><span className="small">{t.currency ?? ''}</span></div>
        </div>
        {(t.title_en || t.buyer_en) && <section className="card stack small">
          <span className="lbl">Original text</span><div>{t.title}</div>{t.buyer && <div className="muted">{t.buyer}</div>}
        </section>}
        <section className="card stack">
          <h2>Dates</h2>
          <div className="grid g3 small"><div><span className="lbl">Published</span><div>{at(t.published)}</div></div>
            <div><span className="lbl">Closing</span><div>{at(t.closing)}</div></div><div><span className="lbl">Awarded</span><div>{at(t.awarded)}</div></div></div>
        </section>
        <section className="card stack">
          <h2>Medicines in this tender</h2>
          {mols.length === 0 ? <p className="muted small">Not matched to a molecule yet: read the official notice for the item list.</p>
            : <div className="row" style={{ gap: 6 }}>{mols.map((m) => m.product
              ? <Link key={m.id} className="pill blue" href={`/m/products/${m.product}?market=${t.country}`}>{m.inn} · yours</Link>
              : <span key={m.id} className="pill">{m.inn}</span>)}</div>}
        </section>
        <section className="card between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span>Want to bid, or supply a distributor who does? Our team checks eligibility, documents and timing.</span>
          <Link className="btn btn-blue btn-sm" href="/m/call?topic=market_entry">Talk to us about this tender</Link>
        </section>
      </>)}
    </Shell>
  );
}
