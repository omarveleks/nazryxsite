import Brand from '@/components/Brand';
import { saveMfrProfile } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { CERTIFICATIONS, MFR_COUNTRIES } from '@/lib/mfr';

export const metadata = { title: 'Your company' };

// Manufacturer onboarding, and the profile editor later (from Settings). The team approves new profiles.
export default async function MfrOnboarding({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ allowOnboarding: true, manufacturer: true });
  const p = await withUser(u.id, (db) => one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]));
  const editing = Boolean(p);
  return (
    <div className="wrap-narrow">
      <Brand href="/m" />
      <div>
        {!editing && <div className="crumb">Step 2 of 2: your company</div>}
        <h1>{editing ? 'Your company' : 'Tell us about your company'}</h1>
        <p className="muted" style={{ marginTop: 8 }}>We use this to match your products to markets and to brief our team. Our team reviews every manufacturer before introducing you to partners.</p>
      </div>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      <form action={saveMfrProfile} className="stack">
        <input type="hidden" name="next" value={sp.next ?? (editing ? '/settings?saved=1' : '/m?welcome=1')} />
        <section className="card stack">
          <h2>1. Company</h2>
          <div className="form-grid">
            <div className="field full"><label htmlFor="company_name">Company name</label>
              <input className="input" id="company_name" name="company_name" required defaultValue={p?.company_name ?? ''} /></div>
            <div className="field"><label htmlFor="hq_country">Headquarters country</label>
              <input className="input" id="hq_country" name="hq_country" defaultValue={p?.hq_country ?? ''} placeholder="e.g. India" /></div>
            <div className="field"><label htmlFor="website">Website</label>
              <input className="input" id="website" name="website" defaultValue={p?.website ?? ''} placeholder="https://" /></div>
          </div>
        </section>
        <section className="card stack">
          <h2>2. Certifications</h2>
          <div className="grid g2">{CERTIFICATIONS.map((c) => (
            <label key={c} className="choice"><input type="checkbox" name="certifications" value={c} defaultChecked={p?.certifications?.includes(c)} /><span>{c}</span></label>))}</div>
        </section>
        <section className="card stack">
          <h2>3. Which markets do you want to enter?</h2>
          <p className="note">Tanzania has live market data today. For the others our team works the market for you; data screens follow.</p>
          <div className="grid g3">{MFR_COUNTRIES.map((c) => (
            <label key={c.code} className="choice"><input type="checkbox" name="target_countries" value={c.code} defaultChecked={p ? p.target_countries?.includes(c.code) : c.code === 'TZ'} />
              <span>{c.name}{c.data ? '' : <span className="note"> · agency</span>}</span></label>))}</div>
        </section>
        <div className="row"><button className="btn btn-blue" type="submit">{editing ? 'Save' : 'Continue'}</button></div>
      </form>
    </div>
  );
}
