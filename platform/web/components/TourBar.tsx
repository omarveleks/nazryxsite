import { tourGo } from '@/app/actions/mfr';
import { TOUR } from '@/lib/tour';

/** The guided tour after sign-up: what this page is for, then Back, Next or End. */
export default function TourBar({ step }: { step: number }) {
  const t = TOUR[step - 1];
  if (!t) return null;
  const last = step === TOUR.length;
  return (
    <section className="card stack" style={{ borderColor: 'var(--blue)', borderWidth: 2, gap: 8 }} aria-label="Guided tour">
      <div className="between small">
        <span className="lbl">Tour · {step} of {TOUR.length}</span>
        <form action={tourGo}><input type="hidden" name="step" value="0" /><button className="btn-link small" type="submit">End tour</button></form>
      </div>
      <div className="meter"><i style={{ width: `${(100 * step) / TOUR.length}%` }} /></div>
      <h2>{t.title}</h2>
      <p className="muted">{t.text}{t.tip ? <> <b>{t.tip}</b></> : null}</p>
      <div className="row">
        {step > 1 && <form action={tourGo}><input type="hidden" name="step" value={step - 1} /><button className="btn btn-ghost btn-sm" type="submit">← Back</button></form>}
        <form action={tourGo}><input type="hidden" name="step" value={last ? 0 : step + 1} />
          <button className="btn btn-blue btn-sm" type="submit">{last ? 'Finish the tour' : `Next: ${TOUR[step].title} →`}</button></form>
      </div>
    </section>
  );
}
