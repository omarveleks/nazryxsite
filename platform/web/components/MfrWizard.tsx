import Link from 'next/link';
import Brand from '@/components/Brand';
import PlanChooser, { type PlanPrices } from '@/components/PlanChooser';
import { saveWizard } from '@/app/actions/mfr';
import { CORE_MARKETS, GOALS, LAUNCH_SCOPES, NEEDS, OTHER_MARKETS, TIMELINES, WIZARD, type WizardStep } from '@/lib/mfr';

const TITLES: Record<WizardStep, [string, string]> = {
  company: ['What is your company called?', 'So our team knows who we are working with.'],
  markets: ['Which markets do you want to enter?', 'Pick as many as you like. You can change them later.'],
  goals: ['What do you want?', 'Pick all that apply.'],
  help: ['Where do you want our help?', 'Pick all that apply. It shapes what we suggest.'],
  timeline: ['When do you want to file?', 'Your best guess is fine.'],
  scope: ['How many products could you launch there in the next 12 months?', 'Often it depends on what the data shows. That is a fine answer.'],
  products: ['Add your products', 'Paste your list, one product per line, or upload your catalogue. You can also skip this and add them later.'],
  plan: ['Your suggested plan', 'From your answers. Pick one, or explore first.'],
};

/** First-time manufacturer sign-up: one question per screen, a progress bar, single choices advance on a click. */
export default function MfrWizard({ q, p, products, prices, error, note }: {
  q: WizardStep; p: any; products: number; prices: PlanPrices; error?: string; note?: string;
}) {
  const i = WIZARD.indexOf(q), n = WIZARD.length;
  const [title, sub] = TITLES[q];
  const has = (k: string, v: string) => Boolean(p?.[k]?.includes(v));
  const Checks = ({ name, list, field }: { name: string; list: [string, string][]; field?: string }) => (
    <div className="stack" style={{ gap: 8 }}>{list.map(([v, l]) => (
      <label key={v} className="choice"><input type="checkbox" name={name} value={v} defaultChecked={has(field ?? name, v)} /><span>{l}</span></label>))}</div>);
  const OneClick = ({ list, current }: { list: [string, string][]; current?: string | null }) => (
    <div className="stack" style={{ gap: 8 }}>{list.map(([v, l]) => (
      <button key={v} type="submit" name="choice" value={v} className="choice"
        style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', background: current === v ? 'var(--soft)' : 'var(--card)', borderColor: current === v ? 'var(--blue)' : undefined }}>
        <span>{l}</span></button>))}</div>);
  const Next = ({ label = 'Continue', skip }: { label?: string; skip?: boolean }) => (
    <div className="row">
      <button className="btn btn-blue" type="submit">{label}</button>
      {skip && <button className="btn btn-ghost" type="submit" name="skip" value="1">Skip for now</button>}
    </div>);
  return (
    <div className="wrap-narrow" style={q === 'plan' ? { maxWidth: 1080 } : { maxWidth: 620 }}>
      <Brand href="/m" />
      <div className="stack" style={{ gap: 6 }}>
        <div className="between small"><span className="muted">Step {i + 1} of {n}</span>
          {i > 0 && <Link className="btn-link" href={`/m/onboarding?q=${WIZARD[i - 1]}`}>← Back</Link>}</div>
        <div className="meter"><i style={{ width: `${(100 * (i + 1)) / n}%` }} /></div>
      </div>
      <div><h1>{title}</h1><p className="muted" style={{ marginTop: 6 }}>{sub}</p></div>
      {error && <div className="err" role="alert">{error}</div>}
      {note && <div className="ok" role="status">{note}</div>}

      {q === 'plan' ? <PlanChooser p={p} prices={prices} products={products} from="onboarding" /> : (
        <form action={saveWizard} className="stack">
          <input type="hidden" name="q" value={q} />
          {q === 'company' && (<>
            <div className="field"><label htmlFor="company_name">Company name</label>
              <input className="input" id="company_name" name="company_name" required autoFocus defaultValue={p?.company_name ?? ''} /></div>
            <div className="field"><label htmlFor="hq_country">Where are you based?</label>
              <input className="input" id="hq_country" name="hq_country" defaultValue={p?.hq_country ?? ''} placeholder="e.g. India" /></div>
            <Next />
          </>)}
          {q === 'markets' && (<>
            <div className="grid g2">{CORE_MARKETS.map((c) => (
              <label key={c.code} className="choice"><input type="checkbox" name="target_countries" value={c.code}
                defaultChecked={p?.target_countries?.length ? p.target_countries.includes(c.code) : c.code === 'TZ'} /><span>{c.name}</span></label>))}</div>
            <details open={OTHER_MARKETS.some((c) => p?.target_countries?.includes(c.code))}>
              <summary className="btn-link small">More markets</summary>
              <div className="grid g2" style={{ marginTop: 10 }}>{OTHER_MARKETS.map((c) => (
                <label key={c.code} className="choice"><input type="checkbox" name="target_countries" value={c.code} defaultChecked={p?.target_countries?.includes(c.code)} /><span>{c.name}</span></label>))}</div>
            </details>
            <Next />
          </>)}
          {q === 'goals' && (<><Checks name="goals" list={GOALS} /><Next /></>)}
          {q === 'help' && (<><Checks name="services" list={NEEDS} /><Next /></>)}
          {q === 'timeline' && <OneClick list={TIMELINES} current={p?.timeline} />}
          {q === 'scope' && <OneClick list={LAUNCH_SCOPES} current={p?.launch_scope} />}
          {q === 'products' && (<>
            <textarea className="input" name="list" rows={7} aria-label="Product list" placeholder={'Amlodipine 5 mg tablets\nCeftriaxone 1 g injection\nMetformin 500 mg tablets'} />
            <div className="field"><label htmlFor="catalogue">Or upload your catalogue <span className="note">(Excel, CSV, PDF or Word)</span></label>
              <input id="catalogue" name="catalogue" type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.txt" /></div>
            {products > 0 && <p className="note">You have {products} product{products === 1 ? '' : 's'} so far.</p>}
            <Next label="Continue" />
          </>)}
        </form>)}
    </div>
  );
}
