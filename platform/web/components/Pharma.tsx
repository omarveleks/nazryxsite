import { BE_STATUS, DOSSIER_ITEMS, DOSSIER_STATUS, SHIPMENT_DOCS, SHIPMENT_FLOW, fmtDate } from '@/lib/format';

type Quote = { payment_terms?: string | null; shelf_life_pct?: number | null; gmp_by?: string | null; supplier_type?: string | null; exclusive?: boolean | null };

/** Terms that decide a pharma purchase, shown on every quote before the supplier is revealed. */
export function QuoteTerms({ q }: { q: Quote }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      {q.supplier_type && <span className={`pill ${q.supplier_type === 'manufacturer' ? 'mint' : ''}`}>{q.supplier_type === 'manufacturer' ? 'Manufacturer' : 'Trader'}</span>}
      {q.gmp_by && <span className="pill blue">GMP: {q.gmp_by}</span>}
      {q.shelf_life_pct != null && <span className="pill">Shelf life on arrival ≥ {q.shelf_life_pct}%</span>}
      {q.payment_terms && <span className="pill">{q.payment_terms}</span>}
      {q.exclusive && <span className="pill solid">Exclusive</span>}
    </span>
  );
}

/** Dossier readiness: a bar, the bioequivalence call, then each item. Items marked not needed do not count. */
export function DossierReadiness({ be, beNote, items, compact }: {
  be?: string | null; beNote?: string | null; items: { item: string; status: string; note?: string | null }[]; compact?: boolean;
}) {
  const counted = items.filter((i) => i.status !== 'not_needed');
  const ready = counted.filter((i) => i.status === 'have').length;
  const total = DOSSIER_ITEMS.length - items.filter((i) => i.status === 'not_needed').length;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="between"><span>{ready} of {total} items ready</span>
        {be && <span className={`pill ${be === 'needed' ? 'peach' : be === 'biowaiver' ? 'blue' : 'mint'}`}>{BE_STATUS[be]}</span>}</div>
      <div className="meter"><i style={{ width: `${total ? (100 * ready) / total : 0}%` }} /></div>
      {beNote && <p className="note">{beNote}</p>}
      {!compact && (
        <table className="tbl"><tbody>{DOSSIER_ITEMS.map(([k, label]) => {
          const it = items.find((x) => x.item === k);
          const [l, cls] = it ? DOSSIER_STATUS[it.status] : ['Not checked yet', ''];
          return (<tr key={k}><td>{label}{it?.note ? <div className="sub2">{it.note}</div> : null}</td>
            <td className="r"><span className={`pill ${cls}`}>{l}</span></td></tr>);
        })}</tbody></table>)}
    </div>
  );
}

/** Where a shipment is on the import route, its ETA and which documents are ready. */
export function ShipmentTrack({ status, eta, docs }: { status: string; eta?: string | Date | null; docs: { doc: string; ready: boolean }[] }) {
  const at = SHIPMENT_FLOW.indexOf(status as (typeof SHIPMENT_FLOW)[number]);
  const ready = SHIPMENT_DOCS.filter(([k]) => docs.some((d) => d.doc === k && d.ready));
  const missing = SHIPMENT_DOCS.filter(([k]) => !docs.some((d) => d.doc === k && d.ready));
  return (
    <div className="stack" style={{ gap: 10 }}>
      {status === 'Cancelled' ? <span className="pill">Cancelled</span> : (
        <span className="row" style={{ gap: 6 }}>{SHIPMENT_FLOW.map((s, i) => (
          <span key={s} className={`pill ${i < at ? 'mint' : i === at ? 'solid' : ''}`}>{s}</span>))}</span>)}
      <div className="between small"><span>Documents ready: <b className="num">{ready.length} of {SHIPMENT_DOCS.length}</b></span>
        {eta && <span>ETA {fmtDate(eta)}</span>}</div>
      {missing.length > 0 && <span className="sub2">Waiting for: {missing.map(([, l]) => l).join(', ')}</span>}
    </div>
  );
}
