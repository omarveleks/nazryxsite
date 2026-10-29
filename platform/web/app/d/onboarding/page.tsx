import Shell from '@/components/Shell';
import Brand from '@/components/Brand';
import { Flash } from '@/components/ui';
import { saveDistributorProfile } from '@/app/actions/market';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, withUser } from '@/lib/db';
import { MFR_COUNTRIES, THERAPEUTIC_AREAS, countryName } from '@/lib/mfr';

export const metadata = { title: 'Your company' };

// A distributor's profile, in one screen: company, home market, the markets served and the classes carried. Free.
// Nazryx verifies distributors who send a wholesale licence; verified ones are shown first to manufacturers.
export default async function DistOnboarding({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ allowOnboarding: true, distributor: true });
  const t = setLang(langOf(u));
  const p = await withUser(u.id, (db) => one(db, 'select * from distributor_profiles where user_id = $1', [u.id]));
  const form = (
    <form action={saveDistributorProfile} className="stack" style={{ maxWidth: 640 }}>
      <Flash sp={sp} />
      <section className="card stack">
        <div className="field"><label htmlFor="company_name">{t('Company')}</label>
          <input className="input" id="company_name" name="company_name" defaultValue={p?.company_name ?? ''} maxLength={160} required placeholder={t('Legal name of the distributor or importer')} /></div>
        <div className="field"><label htmlFor="country">{t('Home market')}</label>
          <select className="input" id="country" name="country" defaultValue={p?.country ?? u.country ?? ''} required>
            <option value="">{t('Pick a country')}</option>{MFR_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{t(c.name)}</option>)}</select></div>
        <div className="field"><span className="lbl">{t('Markets you serve')}</span>
          <div className="grid g3">{MFR_COUNTRIES.map((c) => <label key={c.code} className="check"><input type="checkbox" name="markets" value={c.code} defaultChecked={p?.markets?.includes(c.code)} /> {t(countryName(c.code))}</label>)}</div></div>
        <div className="field"><span className="lbl">{t('Classes you carry')}</span>
          <div className="grid g2">{THERAPEUTIC_AREAS.map((a) => <label key={a} className="check"><input type="checkbox" name="categories" value={a} defaultChecked={p?.categories?.includes(a)} /> {t(a)}</label>)}</div></div>
        <div className="field"><label htmlFor="about">{t('About you')}</label>
          <textarea className="input" id="about" name="about" rows={3} maxLength={1000} defaultValue={p?.about ?? ''} placeholder={t('Channels, reach, the kind of manufacturers you look for')} /></div>
        <div className="between"><span className="note">{t('Manufacturers see your company name and markets, never your email. Verification: send your wholesale licence to the Nazryx team.')}</span>
          <button className="btn btn-blue" type="submit">{u.onboarded ? t('Save') : t('Continue')}</button></div>
      </section>
    </form>);
  if (u.onboarded) return <Shell user={u} title={t('Your company')} sub={t('What manufacturers see about you')}>{form}</Shell>;
  return (
    <div className="auth" style={{ alignItems: 'flex-start' }}>
      <div className="auth-l" style={{ maxWidth: 720 }}>
        <Brand href="/" />
        <div><h1>{t('Your company')}</h1><p className="muted" style={{ marginTop: 10 }}>{t('One minute. Then post your first need.')}</p></div>
        {form}
      </div>
    </div>
  );
}
