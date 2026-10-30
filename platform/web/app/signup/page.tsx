import Link from 'next/link';
import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import { getUser } from '@/lib/auth';
import { setLang } from '@/lib/i18n';
import { cookieLang } from '@/lib/i18n-server';
import { sendLoginLink, signIn, signUp } from '@/app/actions/auth';

export const metadata = { title: 'Sign up' };

const SIDE = {
  head: 'You make medicines. We open the markets.', sub: 'Market data, partners and registration in nine markets across Africa and Central Asia, from Tanzania and Nigeria to Kazakhstan and Senegal.',
  steps: ['Tell us your company, markets and catalogue.', 'See which products to register first, and why.', 'We find the partner and take you through registration.'],
};

export default async function SignUp({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string; as?: string; sent?: string }> }) {
  const sp = await searchParams;
  if (await getUser()) redirect('/');
  const t = setLang(await cookieLang());
  const signin = sp.mode === 'signin';
  const S = SIDE;
  return (
    <div className="auth">
      <main className="auth-l" id="main">
        <Brand href="/signup" />
        <div>
          <h1>{signin ? 'Welcome back' : 'Take your products further.'}</h1>
          <p className="muted" style={{ marginTop: 10 }}>{t('Bridging the gap in medical trade across frontier markets.')}</p>
        </div>
        <nav className="tabs" aria-label={t('Account')}>
          <Link href="/signup" className={!signin ? 'on' : ''} aria-current={!signin ? 'page' : undefined}>{t('Create account')}</Link>
          <Link href="/signup?mode=signin" className={signin ? 'on' : ''} aria-current={signin ? 'page' : undefined}>{t('Sign in')}</Link>
        </nav>
        {sp.error && <div className="err" role="alert">{sp.error}</div>}
        {sp.sent && <div className="ok" role="status">{t('If that email has an account, a sign-in link is on its way. It works once, for 15 minutes.')}</div>}
        {signin ? (
          <form action={signIn} className="stack">
            <input type="hidden" name="account_type" value="manufacturer" />
            <div className="field"><label htmlFor="email">{t('Work email')}</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder={t('name@company.com')} /></div>
            <div className="field"><label htmlFor="password">{t('Password')}</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <button className="btn btn-blue" type="submit">{t('Sign in')}</button>
            <button className="btn-link" type="submit" formAction={sendLoginLink} formNoValidate>{t('Email me a sign-in link instead')}</button>
          </form>
        ) : (
          <form action={signUp} className="stack">
            <input type="hidden" name="account_type" value="manufacturer" />
            <div className="field"><label htmlFor="name">{t('Full name')}</label>
              <input className="input" id="name" name="name" autoComplete="name" required placeholder={t('Full name')} /></div>
            <div className="field"><label htmlFor="email">{t('Work email')}</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder={t('name@company.com')} /></div>
            <div className="field"><label htmlFor="password">{t('Password')}</label>
              <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required placeholder={t('At least 10 characters')} /></div>
            <button className="btn btn-blue" type="submit">{t('Create account')}</button>
            <p className="note">{t('Next: a few questions about your company, markets and catalogue (about 5 minutes). We then suggest the right plan.')}</p>
          </form>
        )}
      </main>
      <aside className="auth-r">
        <h2>{S.head}</h2>
        <p>{S.sub}</p>
        <ol className="steps">
          {S.steps.map((t, i) => <li key={i}><em>0{i + 1}</em><span>{t}</span></li>)}
        </ol>
      </aside>
    </div>
  );
}
