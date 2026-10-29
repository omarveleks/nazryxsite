import Link from 'next/link';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { addSeat, changePassword, updateSettings } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { LANGS, langOf, setLang } from '@/lib/i18n';
import { rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { ACCOUNT_DOC_KINDS } from '@/lib/docs';

export const metadata = { title: 'Settings' };

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; upgrade?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ shared: true });
  const t = setLang(langOf(u));
  const paid = u.plan === 'paid';   // team seats come with the paid account plan
  const d = await withUser(u.id, async (db) => ({
    seats: await rows(db, 'select email, name from users where owner_id = $1 order by created_at', [u.id]),
    docs: await rows(db, 'select id, kind, title, file_name, created_at from account_documents where user_id = $1 order by created_at desc', [u.id]),
    twoStep: Boolean((await rows(db, 'select enabled from user_totp where user_id = $1 and enabled', [u.id])).length),
  }));
  const channel = u.notify_email && u.notify_whatsapp ? 'both' : u.notify_whatsapp ? 'whatsapp' : u.notify_email ? 'email' : 'inapp';
  return (
    <Shell user={u} title={t('Settings and plan')} sub={t('Account and usage')}>
      <Flash sp={sp} />
      <div className="grid g2">
        <section className="card stack" id="plan">
          <h2>{t('Your plan')}</h2>
          <p className="note">{t('Your plan, the markets in it, and the other plans and add-ons.')}</p>
          <Link className="btn btn-blue btn-sm" href="/m/plan" style={{ alignSelf: 'flex-start' }}>{t('See your plan')}</Link>
        </section>
        <section className="card stack" id="company">
          <h2>{t('Your company')}</h2>
          <p className="note">{t('Company details, certifications and the markets you want to enter.')}</p>
          <Link className="btn btn-ghost btn-sm" href="/m/onboarding?step=1" style={{ alignSelf: 'flex-start' }}>{t('Edit company')}</Link>
        </section>
        {(paid || d.seats.length > 0 || u.owner_id) && (
        <section className="card stack" id="team">
          <h2>{t('Team seats')}</h2>
          {paid && !u.owner_id ? (<>
            {d.seats.map((s) => <div key={s.email} className="between"><span>{s.name || s.email}</span><span className="small muted">{s.email}</span></div>)}
            <form action={addSeat} className="stack">
              <div className="form-grid">
                <input className="input" name="name" placeholder={t('Name')} aria-label={t('Teammate name')} />
                <input className="input" name="email" type="email" placeholder={t('Work email')} aria-label={t('Teammate email')} required />
                <input className="input full" name="password" type="password" placeholder={t('First password (10+ characters)')} aria-label={t('First password')} required minLength={10} />
              </div>
              <button className="btn btn-ghost btn-sm" type="submit">{t('Add teammate')}</button>
            </form></>) : <p className="note">{t('You are on a teammate seat.')}</p>}
        </section>)}
        <section className="card stack">
          <h2>{t('Notifications and language')}</h2>
          <form action={updateSettings} className="stack">
            <div className="field"><label htmlFor="name">{t('Name')}</label><input className="input" id="name" name="name" defaultValue={u.name} /></div>
            <div className="field"><label htmlFor="whatsapp">{t('WhatsApp number')}</label><input className="input" id="whatsapp" name="whatsapp" defaultValue={u.whatsapp ?? ''} placeholder="+255 ..." /></div>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
              <legend className="lbl">{t('Send updates by')}</legend>
              {[['whatsapp', 'WhatsApp'], ['email', 'Email'], ['both', 'Email and WhatsApp'], ['inapp', 'In-app only']].map(([v, l]) => (
                <label key={v} className="row small" style={{ gap: 8 }}><input type="radio" name="channel" value={v} defaultChecked={channel === v} />{l}</label>))}
            </fieldset>
            <div className="field"><label htmlFor="language">{t('Language')}</label>
              <select className="input" id="language" name="language" defaultValue={u.language}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <button className="btn btn-blue btn-sm" type="submit">{t('Save')}</button>
          </form>
        </section>
        <section className="card stack" id="documents">
          <h2>{t('Documents')}</h2>
          <p className="note">{t('Agreements, invoices and other papers from Nazryx. Documents for a request or engagement are on its page.')}</p>
          {d.docs.length === 0 ? <p className="muted">{t('None yet.')}</p> : d.docs.map((x) => (
            <div key={x.id} className="between"><a href={`/files/account/${x.id}`}>{x.title || x.file_name}</a>
              <span className="sub2">{ACCOUNT_DOC_KINDS[x.kind]} · {fmtDate(x.created_at)}</span></div>))}
        </section>
        <section className="card stack">
          <h2>{t('Profile and security')}</h2>
          {u.account_type === 'manufacturer' && <p>{u.mfr_verified ? <b>{t('Verified manufacturer')}</b>
            : <span className="note">{t('Not verified yet. We verify manufacturers once their company details and certificates are in.')}</span>}</p>}
          <hr className="divider" />
          <div className="between"><span>Two-step sign-in: <b>{d.twoStep ? 'on' : 'off'}</b></span>
            <a className="btn btn-ghost btn-sm" href="/settings/security">{d.twoStep ? 'Manage' : 'Set up'}</a></div>
          <form action={changePassword} className="row">
            <input className="input" name="password" type="password" minLength={10} placeholder={t('New password')} aria-label={t('New password')} style={{ flex: '1 1 200px' }} required />
            <button className="btn btn-ghost btn-sm" type="submit">{t('Change password')}</button>
          </form>
        </section>
      </div>
    </Shell>
  );
}
