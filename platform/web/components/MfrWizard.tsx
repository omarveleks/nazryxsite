import Link from 'next/link';
import Brand from '@/components/Brand';
import { type PlanPrices } from '@/components/PlanChooser';
import { saveWizard } from '@/app/actions/mfr';
import { CORE_MARKETS, OTHER_MARKETS, WIZARD, countryName, type WizardStep } from '@/lib/mfr';

const TITLES: Record<WizardStep, [string, string]> = {
  company: ['What is your company called?', 'As it appears on your registrations, so we can find what you already hold.'],
  markets: ['Which markets do you want to enter?', 'Pick as many as you like. You can change them later.'],
  products: ['Add your products', 'Paste your list, one product per line, or upload your catalogue. You can also skip this and add them later.'],
};
export type Found = { company_id: number; name: string; country: string; registrations: number; molecules: number };

/** First-time manufacturer sign-up: one question per screen, a progress bar, single choices advance on a click. */
export default function MfrWizard({ q, p, products, error, note, found = [] }: {
  q: WizardStep; p: any; products: number; prices?: PlanPrices; error?: string; note?: string; interval?: 'month' | 'year'; market?: string; found?: Found[];
}) {
  const i = WIZARD.indexOf(q), n = WIZARD.length;
  const [title, sub] = TITLES[q];
  // registrations in our markets under the company's name: one line per company found, the markets and counts
  const byCompany = new Map<number, { name: string; n: number; markets: string[] }>();
  for (const f of found) { const x = byCompany.get(f.company_id) ?? { name: f.name, n: 0, markets: [] }; x.n += f.registrations; x.markets.push(countryName(f.country)); byCompany.set(f.company_id, x); }
  const Next = ({ label = 'Continue', skip }: { label?: string; skip?: boolean }) => (
    <div className="row">
      <button className="btn btn-blue" type="submit">{label}</button>
      {skip && <button className="btn btn-ghost" type="submit" name="skip" value="1">Skip for now</button>}
    </div>);
  return (
    <div className="wrap-narrow" style={{ maxWidth: 620 }}>
      <Brand href="/m" />
      <div className="stack" style={{ gap: 6 }}>
        <div className="between small"><span className="muted">Step {i + 1} of {n}</span>
          {i > 0 && <Link className="btn-link" href={`/m/onboarding?q=${WIZARD[i - 1]}`}>← Back</Link>}</div>
        <div className="meter"><i style={{ width: `${(100 * (i + 1)) / n}%` }} /></div>
      </div>
      <div><h1>{title}</h1><p className="muted" style={{ marginTop: 6 }}>{sub}</p></div>
      {error && <div className="err" role="alert">{error}</div>}
      {note && <div className="ok" role="status">{note}</div>}

      {(
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
            {byCompany.size > 0 && (
              <div className="card stack" style={{ borderColor: 'var(--blue)' }}>
                <span className="lbl">We found you in the registers</span>
                {[...byCompany.entries()].map(([id, x]) => (
                  <label key={id} className="choice"><input type="checkbox" name="claim" value={id} defaultChecked />
                    <span><b>{x.name}</b>: {x.n} registered {x.n === 1 ? 'product' : 'products'} in {x.markets.join(', ')}</span></label>))}
                <span className="note">Tick what is yours. Those products go straight into your portfolio, marked as registered by you, and we skip asking for them.</span>
              </div>)}
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
          {q === 'products' && (<>
            <textarea className="input" name="list" rows={7} aria-label="Product list" placeholder={'Amlodipine 5 mg tablets\nCeftriaxone 1 g injection\nMetformin 500 mg tablets'} />
            <div className="field"><label htmlFor="catalogue">Or upload your catalogue <span className="note">(Excel, CSV, PDF or Word)</span></label>
              <input id="catalogue" name="catalogue" type="file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.txt" /></div>
            {products > 0 && <p className="note">You have {products} product{products === 1 ? '' : 's'} so far.</p>}
            <Next label={products > 0 ? 'See my portfolio' : 'Continue'} skip={products === 0} />
          </>)}
        </form>)}
    </div>
  );
}
