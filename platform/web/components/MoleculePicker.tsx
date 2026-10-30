'use client';
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Item = { id: number; inn: string; forms?: string[] | null; n?: number | null };

/** A molecule from the manufacturer's catalogue, found by typing: a list of hundreds is unusable as a drop-down. Picking one
 *  reloads the page for it with the other inputs kept. */
export default function MoleculePicker({ items, value, label, placeholder, nothing, more }: { items: Item[]; value: number | null; label: string; placeholder: string; nothing: string; more: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const current = items.find((i) => i.id === value);
  const [q, setQ] = useState(current?.inn ?? '');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s && s !== (current?.inn ?? '').toLowerCase() ? items.filter((i) => i.inn.toLowerCase().includes(s)) : items;
    return list.slice(0, 12);
  }, [q, items, current]);
  const choose = (i: Item) => {
    setQ(i.inn); setOpen(false);
    const p = new URLSearchParams(sp.toString()); p.set('molecule', String(i.id)); p.delete('form');
    router.push(`/m/simulator?${p.toString()}`);
  };
  return (
    <div className="search" style={{ width: '100%', maxWidth: 'none' }}>
      <label className="small" htmlFor="mol-q" style={{ display: 'block' }}>{label}</label>
      <input id="mol-q" className="input" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setSel(0); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-expanded={open} aria-controls="mol-hits" aria-autocomplete="list"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setSel((s) => Math.min(hits.length - 1, s + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === 'Enter' && open && hits[sel]) { e.preventDefault(); choose(hits[sel]); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      <input type="hidden" name="molecule" value={value ?? ''} />
      {open && (
        <div id="mol-hits" role="listbox" className="card" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 40, padding: 6, maxHeight: 320, overflowY: 'auto' }}>
          {hits.length === 0 ? <div className="small muted" style={{ padding: '8px 10px' }}>{nothing}</div>
            : hits.map((i, idx) => (
              <button key={i.id} type="button" role="option" aria-selected={idx === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)} onMouseEnter={() => setSel(idx)}
                className="between" style={{ width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, borderRadius: 8, cursor: 'pointer', font: 'inherit', background: idx === sel ? 'var(--soft)' : 'transparent', gap: 10 }}>
                <span style={{ minWidth: 0 }}><span className="nm" style={{ fontSize: 14 }}>{i.inn}</span>{i.forms?.length ? <span className="sub2"> · {i.forms.slice(0, 3).join(', ')}</span> : null}</span>
                {i.n ? <span className="pill" style={{ fontSize: 11, flexShrink: 0 }}>{i.n}</span> : null}
              </button>))}
          {items.length > hits.length && hits.length >= 12 && <div className="sub2" style={{ padding: '6px 10px' }}>{more.replace('{n}', String(items.length - hits.length))}</div>}
        </div>)}
    </div>
  );
}
