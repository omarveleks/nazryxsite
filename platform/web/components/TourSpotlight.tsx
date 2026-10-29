'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tourGo } from '@/app/actions/mfr';

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const EASE = 'cubic-bezier(.2, .7, .2, 1)';
const veilBase: React.CSSProperties = {
  position: 'fixed', background: 'rgba(20, 20, 19, 0.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 60,
  transition: `top .45s ${EASE}, left .45s ${EASE}, width .45s ${EASE}, height .45s ${EASE}, opacity .35s ease`,
};

/** Fades in after `delay`, and out when the visitor moves on. */
function useFade(delay: number) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => { setMounted(true); const t = setTimeout(() => setShown(true), delay); return () => clearTimeout(t); }, [delay]);
  return [shown, () => setShown(false), mounted] as const;
}

const Step = ({ step, label, cls, onGo }: { step: number; label: string; cls: string; onGo: () => void }) => (
  <form action={tourGo} onSubmit={onGo}><input type="hidden" name="step" value={step} /><button className={cls} type="submit">{label}</button></form>);

/** Right after sign-up, on Home: a pause, then the offer to take the tour or skip it. */
export type TourLabels = { welcome: string; ask: string; intro: string; take: string; skip: string; end: string; tour: string; of: string; back: string; finish: string; next: string };
const EN: TourLabels = { welcome: 'Welcome', ask: 'Take a two-minute tour?', intro: 'We show you each part of Nazryx where it lives: your products, the market, distributors, our services and your plan. You can take it any time from Home.',
  take: 'Take the tour', skip: 'Skip for now', end: 'End tour', tour: 'Tour', of: 'of', back: '← Back', finish: 'Finish the tour', next: 'Next' };

export function TourIntro({ company, labels = EN }: { company?: string | null; labels?: TourLabels }) {
  const [shown, hide, mounted] = useFade(1000);
  if (!mounted) return null;
  return createPortal(
    <div role="dialog" aria-label="Take the tour" style={{ opacity: shown ? 1 : 0, transition: 'opacity .4s ease', pointerEvents: shown ? 'auto' : 'none' }}>
      <div style={{ ...veilBase, inset: 0 }} />
      <div className="card stack" style={{ position: 'fixed', zIndex: 62, left: '50%', top: '50%', width: 'min(440px, calc(100vw - 24px))', gap: 10,
        transform: `translate(-50%, ${shown ? '-50%' : '-46%'})`, transition: `transform .45s ${EASE}`, borderColor: 'var(--blue)', borderWidth: 2 }}>
        <span className="lbl">{labels.welcome}{company ? `, ${company}` : ''}</span>
        <h2 style={{ fontSize: 24 }}>{labels.ask}</h2>
        <p className="muted">{labels.intro}</p>
        <div className="row">
          <Step step={1} label={labels.take} cls="btn btn-blue" onGo={hide} />
          <Step step={0} label={labels.skip} cls="btn btn-ghost" onGo={hide} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The guided tour: everything but the feature being explained is dimmed and blurred; a card next to it explains it,
 *  with Back, Next and End. The highlighted feature stays usable (for example, adding products). */
export default function TourSpotlight({ step, total, target, title, text, tip, nextTitle, fallback, fallbackText, labels = EN }: {
  step: number; total: number; target: string; title: string; text: string; tip?: string; nextTitle?: string; fallback?: string; fallbackText?: string; labels?: TourLabels;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [view, setView] = useState({ w: 1280, h: 800 });
  const [shown, hide, mounted] = useFade(250);

  useEffect(() => {
    // the feature itself, or (when it is not on the page yet, e.g. before any products) the fallback to highlight instead
    const main = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    const el = main ?? (fallback ? document.querySelector<HTMLElement>(`[data-tour="${fallback}"]`) : null);
    setUsedFallback(!main && Boolean(el));
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
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const t = setInterval(measure, 400);          // content above the target can still be loading
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); clearInterval(t); cancelAnimationFrame(raf); };
  }, [target, fallback]);

  if (!mounted) return null;
  const r = rect;
  const phone = view.w < 640;
  // the card goes below the highlighted feature when there is room, otherwise above; on phones it sits at the bottom
  const below = r ? r.top + r.height + 230 < view.h : true;
  const W = Math.min(440, view.w - 24);
  const cardStyle: React.CSSProperties = phone || !r
    ? { left: (view.w - W) / 2, width: W, bottom: 16 }
    : { left: Math.max(12, Math.min(r.left, view.w - W - 12)), width: W, ...(below ? { top: r.top + r.height + 12 } : { bottom: view.h - r.top + 12 }) };
  return createPortal(
    <div role="dialog" aria-label={`Tour step ${step} of ${total}: ${title}`}
      style={{ opacity: shown ? 1 : 0, transition: 'opacity .35s ease', pointerEvents: shown ? 'auto' : 'none' }}>
      {r ? (<>
        <div style={{ ...veilBase, top: 0, left: 0, width: view.w, height: Math.max(0, r.top) }} />
        <div style={{ ...veilBase, top: r.top + r.height, left: 0, width: view.w, height: Math.max(0, view.h - r.top - r.height) }} />
        <div style={{ ...veilBase, top: r.top, left: 0, width: Math.max(0, r.left), height: r.height }} />
        <div style={{ ...veilBase, top: r.top, left: r.left + r.width, width: Math.max(0, view.w - r.left - r.width), height: r.height }} />
        <div style={{ position: 'fixed', top: r.top, left: r.left, width: r.width, height: r.height, border: '2px solid var(--blue)',
          borderRadius: 'var(--r-lg)', zIndex: 61, pointerEvents: 'none', transition: veilBase.transition }} />
      </>) : <div style={{ ...veilBase, inset: 0, backdropFilter: 'none', WebkitBackdropFilter: 'none', background: 'rgba(20, 20, 19, 0.25)' }} />}
      <div className="card stack" style={{ position: 'fixed', zIndex: 62, gap: 8, borderColor: 'var(--blue)', borderWidth: 2, ...cardStyle,
        transform: shown ? 'none' : 'translateY(8px)', transition: `transform .45s ${EASE}, top .45s ${EASE}, left .45s ${EASE}, bottom .45s ${EASE}` }}>
        <div className="between small">
          <span className="lbl">{labels.tour} · {step} {labels.of} {total}</span>
          <Step step={0} label={labels.end} cls="btn-link small" onGo={hide} />
        </div>
        <div className="meter"><i style={{ width: `${(100 * step) / total}%`, transition: `width .6s ${EASE}` }} /></div>
        <h2>{title}</h2>
        <p className="muted">{usedFallback && fallbackText ? fallbackText : <>{text}{tip ? <> <b>{tip}</b></> : null}</>}</p>
        <div className="row">
          {step > 1 && <Step step={step - 1} label={labels.back} cls="btn btn-ghost btn-sm" onGo={hide} />}
          <Step step={step === total ? 0 : step + 1} label={step === total ? labels.finish : `${labels.next}: ${nextTitle} →`} cls="btn btn-blue btn-sm" onGo={hide} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
