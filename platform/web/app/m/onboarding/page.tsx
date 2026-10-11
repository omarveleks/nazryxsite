import Link from 'next/link';
import Brand from '@/components/Brand';
import PlanChooser, { loadPlanPrices } from '@/components/PlanChooser';
import { saveMfrStep } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { APPROACHES, CERTIFICATIONS, COMPANY_SIZES, CONTACT_ROLES, DOSAGE_FORMS, MFR_COUNTRIES, MFR_STEPS, NEEDS, THERAPEUTIC_AREAS, TIMELINES } from '@/lib/mfr';

export const metadata = { title: 'Your company' };

// Manufacturer onboarding in six steps (company, manufacturing, markets, catalogue, needs, suggested plan), and the
// profile editor later from Settings. The team approves new profiles before partner introductions.
export default async function MfrOnboarding({ searchParams }: { searchParams: Promise<{ error?: string; step?: string; saved?: string; note?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ allowOnboarding: true, manufacturer: true });
  const d = await withUser(u.id, async (db) => ({
    p: await one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]),
    products: Number((await one(db, 'select count(*)::int as n from mfr_products where user_id = $1', [u.id]))?.n ?? 0),
    whatsapp: (await one(db, 'select whatsapp from users where id = $1', [u.id]))?.whatsapp as string | null,
    prices: await loadPlanPrices(db),
  }));
  const p = d.p;
  const editing = u.onboarded;
  const reached = p ? (editing ? 6 : Math.min(p.step, 6)) : 1;
  const step = Math.min(Math.max(Number(sp.step) || reached, 1), reached);
  const has = (k: string, v: string) => Boolean(p?.[k]?.includes(v));
  const Checks = ({ name, list, cols = 'g2', field }: { name: string; list: [string, string][] | string[]; cols?: string; field?: string }) => (
    <div className={`grid ${cols}`}>{list.map((x) => {
      const [v, l] = Array.isArray(x) ? x : [x, x];
      return <label key={v} className="choice"><input type="checkbox" name={name} value={v} defaultChecked={has(field ?? name, v)} /><span>{l}</span></label>;
    })}</div>);
  const Radios = ({ name, list }: { name: string; list: [string, string][] }) => (
    <div className="stack" style={{ gap: 8 }}>{list.map(([v, l]) => (
      <label key={v} className="choice"><input type="radio" name={name} value={v} defaultChecked={p?.[name] === v} /><span>{l}</span></label>))}</div>);
  const Buttons = () => (
    <div className="row">
      {editing && <input type="hidden" name="stay" value="1" />}
      {step > 1 && !editing && <Link className="btn btn-ghost" href={`/m/onboarding?step=${step - 1}`}>Back</Link>}
      <button className="btn btn-blue" type="submit">{editing ? 'Save' : 'Continue'}</button>
      {step === 4 && !editing && <span className="note">No list to hand? Continue and add products later.</span>}
    </div>);
  return (
    <div className="wrap-narrow" style={step === 6 ? { maxWidth: 1080 } : undefined}>
      <Brand href="/m" />
      <div>
        <div className="crumb">{editing ? <Link href="/settings">Settings</Link> : `Step ${step} of ${MFR_STEPS.length}`}</div>
        <h1>{step === 6 ? 'Your suggested plan' : editing ? 'Your company' : ['Tell us about your company', 'What you make', 'Where you want to go',
          'Your product catalogue', 'What you need from us'][step - 1]}</h1>
        <p className="muted" style={{ marginTop: 8 }}>{step === 6
          ? 'From your answers. Pick the one that fits; our team confirms scope and price with you.'
          : 'We use this to match your products to markets, brief our team and suggest the right plan. Our team reviews every manufacturer before partner introductions.'}</p>
      </div>
      <nav className="tabs" aria-label="Onboarding steps">
        {MFR_STEPS.map((s, i) => i + 1 <= reached
          ? <Link key={s} href={`/m/onboarding?step=${i + 1}`} className={step === i + 1 ? 'on' : ''}>{i + 1}. {s}</Link>
          : <span key={s} className="lock">{i + 1}. {s}</span>)}
      </nav>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      {sp.saved && <div className="ok" role="status">Saved.{sp.note ? ` ${sp.note}` : ''}</div>}
      {!sp.saved && sp.note && <div className="ok" role="status">{sp.note}</div>}

      {step === 1 && (
        <form action={saveMfrStep} className="stack"><input type="hidden" name="step" value="1" />
          <section className="card stack">
            <div className="form-grid">
              <div className="field full"><label htmlFor="company_name">Company name</label>
                <input className="input" id="company_name" name="company_name" required defaultValue={p?.company_name ?? ''} /></div>
              <div className="field"><label htmlFor="hq_country">Headquarters country</label>
                <input className="input" id="hq_country" name="hq_country" defaultValue={p?.hq_country ?? ''} placeholder="e.g. India" /></div>
              <div className="field"><label htmlFor="website">Website</label>
                <input className="input" id="website" name="website" defaultValue={p?.website ?? ''} placeholder="https://" /></div>
              <div className="field"><label htmlFor="company_size">Company size</label>
                <select className="input" id="company_size" name="company_size" defaultValue={p?.company_size ?? ''}>
                  <option value="">Choose</option>{COMPANY_SIZES.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="field"><label htmlFor="contact_role">Your role</label>
                <select className="input" id="contact_role" name="contact_role" defaultValue={p?.contact_role ?? ''}>
                  <option value="">Choose</option>{CONTACT_ROLES.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="field full"><label htmlFor="whatsapp">WhatsApp or phone (optional)</label>
                <input className="input" id="whatsapp" name="whatsapp" defaultValue={d.whatsapp ?? ''} placeholder="+91 ..." autoComplete="tel" /></div>
            </div>
          </section>
          <Buttons />
        </form>)}

      {step === 2 && (
        <form action={saveMfrStep} className="stack"><input type="hidden" name="step" value="2" />
          <section className="card stack"><h2>Certifications</h2>
            <p className="note">WHO prequalification or approval by a strict regulator usually opens a shorter registration route.</p>
            <Checks name="certifications" list={CERTIFICATIONS} /></section>
          <section className="card stack"><h2>Dosage forms you make</h2><Checks name="dosage_forms" list={DOSAGE_FORMS} cols="g3" /></section>
          <section className="card stack"><h2>Therapeutic areas</h2><Checks name="therapeutic_areas" list={THERAPEUTIC_AREAS} cols="g3" /></section>
          <section className="card stack">
            <div className="field"><label htmlFor="plant_countries">Where are your plants?</label>
              <input className="input" id="plant_countries" name="plant_countries" defaultValue={p?.plant_countries ?? ''} placeholder="e.g. India (Gujarat), Bangladesh" /></div>
            <div className="field"><label htmlFor="export_markets">Where do you sell today?</label>
              <textarea className="input" id="export_markets" name="export_markets" defaultValue={p?.export_markets ?? ''} placeholder="e.g. Nigeria, Ghana, Vietnam, Philippines" /></div>
          </section>
          <Buttons />
        </form>)}

      {step === 3 && (
        <form action={saveMfrStep} className="stack"><input type="hidden" name="step" value="3" />
          <section className="card stack"><h2>Markets you want to enter</h2>
            <p className="note">Tanzania has live market data today. In the others our team works the market for you; data screens follow.</p>
            <div className="grid g3">{MFR_COUNTRIES.map((c) => (
              <label key={c.code} className="choice"><input type="checkbox" name="target_countries" value={c.code}
                defaultChecked={p?.target_countries?.length ? p.target_countries.includes(c.code) : c.code === 'TZ'} />
                <span>{c.name}{c.data ? <span className="note"> · live data</span> : <span className="note"> · agency</span>}</span></label>))}</div>
          </section>
          <section className="card stack"><h2>Already registered in any of them?</h2>
            <Checks name="registered_in" list={MFR_COUNTRIES.map((c) => [c.code, c.name] as [string, string])} cols="g3" /></section>
          <section className="card stack"><h2>When do you want to file?</h2><Radios name="timeline" list={TIMELINES} /></section>
          <section className="card stack"><h2>How do you want to enter?</h2><Radios name="approach" list={APPROACHES} /></section>
          <Buttons />
        </form>)}

      {step === 4 && (
        <form action={saveMfrStep} className="stack"><input type="hidden" name="step" value="4" />
          <section className="card stack">
            <h2>Paste your products</h2>
            <p className="note">One per line, with strength and form, e.g. &ldquo;Amlodipine 5 mg tablets&rdquo;. We match each to the market straight away.
              {d.products ? ` You have ${d.products} product${d.products === 1 ? '' : 's'} so far.` : ''}</p>
            <textarea className="input" name="list" rows={8} aria-label="Product list" placeholder={'Amlodipine 5 mg tablets\nCeftriaxone 1 g injection\nMetformin 500 mg tablets'} />
          </section>
          <section className="card stack">
            <h2>Or upload your catalogue</h2>
            <p className="note">Excel, CSV, PDF or Word, up to 20 MB. Our team loads it for you.{p?.catalogue_name ? ` Uploaded: ${p.catalogue_name}.` : ''}</p>
            <input name="catalogue" type="file" aria-label="Catalogue file" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.txt" />
          </section>
          <Buttons />
        </form>)}

      {step === 5 && (
        <form action={saveMfrStep} className="stack"><input type="hidden" name="step" value="5" />
          <section className="card stack"><h2>What do you need?</h2><p className="note">Pick all that apply.</p><Checks name="services" list={NEEDS} /></section>
          <section className="card stack">
            <div className="field"><label htmlFor="products_next_year">How many products do you want to register in the next 12 months?</label>
              <input className="input" id="products_next_year" name="products_next_year" inputMode="numeric" defaultValue={p?.products_next_year ?? ''} placeholder="e.g. 5" style={{ maxWidth: 160 }} /></div>
          </section>
          <Buttons />
        </form>)}

      {step === 6 && p && <PlanChooser p={p} prices={d.prices} products={d.products} from={editing ? 'plan' : 'onboarding'} />}
    </div>
  );
}
