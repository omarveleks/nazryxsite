'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tourGo } from '@/app/actions/mfr';

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;

/** The guided tour: everything but the feature being explained is dimmed and blurred; a card next to it explains it,
 *  with Back, Next and End. The highlighted feature stays usable (for example, adding products). */
export default function TourSpotlight({ step, total, target, title, text, tip, nextTitle }: {
  step: number; total: number; target: string; title: string; text: string; tip?: string; nextTitle?: string;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState({ w: 1280, h: 800 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setView({ w: window.innerWidth, h: window.innerHeight });
        const r = el?.getBoundingClientRect();
        setRect(r ? { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD } : null);
      });
    };
    measure();
    setReady(true);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const t = setInterval(measure, 400);          // content above the target can still be loading
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); clearInterval(t); cancelAnimationFrame(raf); };
  }, [target]);

  if (!ready) return null;
  const veil: React.CSSProperties = { position: 'fixed', background: 'rgba(20, 20, 19, 0.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 60 };
  const r = rect;
  const phone = view.w < 640;
  // the card goes below the highlighted feature when there is room, otherwise above; on phones it sits at the bottom
  const below = r ? r.top + r.height + 230 < view.h : true;
  const cardStyle: React.CSSProperties = phone || !r
    ? { left: 12, right: 12, bottom: 12 }
    : { left: Math.max(12, Math.min(r.left, view.w - 452)), width: 440, ...(below ? { top: r.top + r.height + 12 } : { bottom: view.h - r.top + 12 }) };
  return createPortal(
    <div role="dialog" aria-label={`Tour step ${step} of ${total}: ${title}`}>
      {r ? (<>
        <div style={{ ...veil, top: 0, left: 0, right: 0, height: Math.max(0, r.top) }} />
        <div style={{ ...veil, top: r.top + r.height, left: 0, right: 0, bottom: 0 }} />
        <div style={{ ...veil, top: r.top, left: 0, width: Math.max(0, r.left), height: r.height }} />
        <div style={{ ...veil, top: r.top, left: r.left + r.width, right: 0, height: r.height }} />
        <div style={{ position: 'fixed', top: r.top, left: r.left, width: r.width, height: r.height, border: '2px solid var(--blue)',
          borderRadius: 'var(--r-lg)', zIndex: 61, pointerEvents: 'none' }} />
      </>) : <div style={{ ...veil, inset: 0 }} />}
      <div className="card stack" style={{ position: 'fixed', zIndex: 62, gap: 8, borderColor: 'var(--blue)', borderWidth: 2, ...cardStyle }}>
        <div className="between small">
          <span className="lbl">Tour · {step} of {total}</span>
          <form action={tourGo}><input type="hidden" name="step" value="0" /><button className="btn-link small" type="submit">End tour</button></form>
        </div>
        <div className="meter"><i style={{ width: `${(100 * step) / total}%` }} /></div>
        <h2>{title}</h2>
        <p className="muted">{text}{tip ? <> <b>{tip}</b></> : null}</p>
        <div className="row">
          {step > 1 && <form action={tourGo}><input type="hidden" name="step" value={step - 1} /><button className="btn btn-ghost btn-sm" type="submit">← Back</button></form>}
          <form action={tourGo}><input type="hidden" name="step" value={step === total ? 0 : step + 1} />
            <button className="btn btn-blue btn-sm" type="submit">{step === total ? 'Finish the tour' : `Next: ${nextTitle} →`}</button></form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
