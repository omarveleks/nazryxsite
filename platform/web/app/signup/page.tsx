import Link from 'next/link';
import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import { getUser } from '@/lib/auth';
import { setLang } from '@/lib/i18n';
import { cookieLang } from '@/lib/i18n-server';
import { signIn, signUp } from '@/app/actions/auth';

export const metadata = { title: 'Sign up' };

// The portal is for manufacturers (the distributor side is paused: see distributor/README.md).
const S = {
  head: 'You make medicines. We open the markets.', sub: 'Market data, partners and registration in Tanzania, Kenya, Kazakhstan, Kyrgyzstan and Uzbekistan.',
  steps: ['Tell us your company, markets and catalogue.', 'See which products to register first, and why.', 'We find the partner and take you through registration.'],
};

export default async function SignUp({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string; as?: string }> }) {
  const sp = await searchParams;
  if (await getUser()) redirect('/');
  const t = setLang(await cookieLang());
  const signin = sp.mode === 'signin';
  return (
    <div className="auth">
      <div className="auth-l">
        <Brand href="/signup" />
        <div>
          <h1>{signin ? 'Welcome back' : 'Take your products further.'}</h1>
          <p className="muted" style={{ marginTop: 10 }}>{t('Bridging the gap in medical trade across frontier markets.')}</p>
        </div>
        <div className="tabs" role="tablist">
          <Link href="/signup" className={!signin ? 'on' : ''}>{t('Create account')}</Link>
          <Link href="/signup?mode=signin" className={signin ? 'on' : ''}>{t('Sign in')}</Link>
        </div>
        {sp.error && <div className="err" role="alert">{sp.error}</div>}
        {signin ? (
          <form action={signIn} className="stack">
            <input type="hidden" name="account_type" value="manufacturer" />
            <div className="field"><label htmlFor="email">{t('Work email')}</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder={t('name@company.com')} /></div>
            <div className="field"><label htmlFor="password">{t('Password')}</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <button className="btn btn-blue" type="submit">{t('Sign in')}</button>
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
      </div>
      <div className="auth-r">
        <h2>{S.head}</h2>
        <p>{S.sub}</p>
        <ol className="steps">
          {S.steps.map((t, i) => <li key={i}><em>0{i + 1}</em><span>{t}</span></li>)}
        </ol>
      </div>
    </div>
  );
}
