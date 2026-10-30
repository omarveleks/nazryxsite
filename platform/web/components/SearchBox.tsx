'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tr, type Lang } from '@/lib/i18n';

type Hit = { kind: string; label: string; sub: string; href: string; country: string | null };
const KIND: Record<string, string> = { molecule: 'Molecule', product: 'Your product', company: 'Distributor', tender: 'Tender', page: 'Page' };

/** One box that understands a molecule, a product, a distributor code or name, a tender, a page; "/" focuses it,
 *  arrows move, Enter opens. "ceftriaxone KZ" narrows to a market. */
export default function SearchBox({ lang = 'en' }: { lang?: Lang }) {
  const t = tr(lang);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); ref.current?.focus(); }
      if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const n = ++seq.current;
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (n === seq.current) { setHits(r.ok ? await r.json() : []); setSel(0); setOpen(true); }
      } catch { /* offline: keep what is shown */ }
    }, 160);
    return () => clearTimeout(h);
  }, [q]);
  const go = (h: Hit) => { setOpen(false); setQ(''); router.push(h.href); };
  return (
    <div className="search" style={{ position: 'relative' }}>
      <input ref={ref} className="input" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t('Search · press /')} aria-label={t('Search')} role="combobox" aria-expanded={open && hits.length > 0} aria-controls="search-hits" autoComplete="off"
        style={{ minHeight: 38, fontSize: 13.5, width: '100%' }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); go(hits[sel]); }
        }} />
      {open && q.trim().length >= 2 && (
        <div id="search-hits" role="listbox" className="card" style={{ position: 'absolute', left: 0, top: 44, width: 380, maxWidth: 'calc(100vw - 32px)', zIndex: 40, padding: 6, maxHeight: 420, overflowY: 'auto' }}>
          {hits.length === 0 ? <div className="small muted" style={{ padding: '8px 10px' }}>{t('Nothing found. Try a molecule, a distributor code, a tender or a page.')}</div>
            : hits.map((h, i) => (
              <button key={h.href + h.label} type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} onMouseEnter={() => setSel(i)}
                className="between" style={{ width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, borderRadius: 8, cursor: 'pointer', font: 'inherit', background: i === sel ? 'var(--soft)' : 'transparent', gap: 10 }}>
                <span style={{ minWidth: 0 }}><span className="nm" style={{ fontSize: 14 }}>{h.label}</span>{h.sub && <span className="sub2"> · {h.sub}</span>}</span>
                <span className="pill" style={{ fontSize: 11, flexShrink: 0 }}>{t(KIND[h.kind] ?? h.kind)}</span>
              </button>))}
        </div>)}
    </div>
  );
}
