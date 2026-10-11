'use client';
import { useEffect, useRef, useState } from 'react';
import { addMfrProduct } from '@/app/actions/mfr';

type Hit = { name: string; atc: string | null; tracked: boolean };
const FORMS = ['Tablets', 'Capsules', 'Oral liquid', 'Injection', 'Infusion', 'Cream or ointment', 'Eye or ear drops', 'Inhaler', 'Powder or sachet', 'Suppository', 'Other'];

/** Search every medicine (ours and the worldwide list), pick one, add strength and form. */
export default function MedicineSearch({ back = '/m/products' }: { back?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (picked || q.trim().length < 2) { setHits([]); return; }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/medicines?q=${encodeURIComponent(q.trim())}`);
        if (n === seq.current) setHits(r.ok ? await r.json() : []);
      } finally { if (n === seq.current) setBusy(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [q, picked]);

  if (picked) return (
    <form action={addMfrProduct} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="name" value={picked.name} /><input type="hidden" name="atc" value={picked.atc ?? ''} />
      <input type="hidden" name="return" value={back} />
      <div className="between"><b>{picked.name}</b><button type="button" className="btn-link small" onClick={() => { setPicked(null); setQ(''); }}>Change</button></div>
      <div className="row">
        <input className="input" name="strength" placeholder="Strength, e.g. 500 mg" aria-label="Strength" style={{ flex: '1 1 140px' }} />
        <select className="input" name="form" aria-label="Dosage form" defaultValue="" style={{ flex: '1 1 160px' }}>
          <option value="">Dosage form</option>{FORMS.map((f) => <option key={f}>{f}</option>)}</select>
      </div>
      <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Add to my products</button>
    </form>);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="lbl" htmlFor="med-q">Search any medicine</label>
      <input className="input" id="med-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing, e.g. amlodipine" autoComplete="off"
        role="combobox" aria-expanded={hits.length > 0} aria-controls="med-hits" />
      {q.trim().length >= 2 && (
        <div id="med-hits" role="listbox" className="stack" style={{ gap: 0, border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          {hits.map((h) => (
            <button key={h.name} type="button" role="option" aria-selected="false" onClick={() => setPicked(h)} className="between"
              style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--card)', border: 0, borderTop: '1px solid var(--line)', cursor: 'pointer', font: 'inherit' }}>
              <span>{h.name}</span><span className="sub2">{h.tracked ? 'On our markets' : h.atc ?? ''}</span>
            </button>))}
          {!busy && hits.length === 0 && (
            <button type="button" onClick={() => setPicked({ name: q.trim(), atc: null, tracked: false })} className="between"
              style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--card)', border: 0, cursor: 'pointer', font: 'inherit' }}>
              <span>Add &ldquo;{q.trim()}&rdquo; as written</span><span className="sub2">Our team matches it</span></button>)}
        </div>)}
    </div>
  );
}
