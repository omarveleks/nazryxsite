import Link from 'next/link';
import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import { getUser } from '@/lib/auth';
import { signIn, signUp } from '@/app/actions/auth';

export const metadata = { title: 'Sign up' };

export default async function SignUp({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await getUser()) redirect('/home');
  const signin = sp.mode === 'signin';
  return (
    <div className="auth">
      <div className="auth-l">
        <Brand href="/signup" />
        <div>
          <h1>{signin ? 'Welcome back' : 'See your market. Fill the gaps.'}</h1>
          <p className="muted" style={{ marginTop: 10 }}>Bridging the gap in medical trade across frontier markets.</p>
        </div>
        <div className="tabs" role="tablist">
          <Link href="/signup" className={!signin ? 'on' : ''}>Create account</Link>
          <Link href="/signup?mode=signin" className={signin ? 'on' : ''}>Sign in</Link>
        </div>
        {sp.error && <div className="err" role="alert">{sp.error}</div>}
        {signin ? (
          <form action={signIn} className="stack">
            <div className="field"><label htmlFor="email">Work email</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" /></div>
            <div className="field"><label htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <button className="btn btn-blue" type="submit">Sign in</button>
          </form>
        ) : (
          <form action={signUp} className="stack">
            <div className="field"><label htmlFor="name">Full name</label>
              <input className="input" id="name" name="name" autoComplete="name" required placeholder="Full name" /></div>
            <div className="field"><label htmlFor="email">Work email</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" /></div>
            <div className="field"><label htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required placeholder="At least 10 characters" /></div>
            <button className="btn btn-blue" type="submit">Create account</button>
            <p className="note">Free plan: 1 country, no card needed. Your work email domain helps us verify your company in the next step.</p>
          </form>
        )}
      </div>
      <div className="auth-r">
        <h2>You know your products. We show you the market.</h2>
        <p>Every registered competitor, every open gap, and a team that sources what you need.</p>
        <ol className="steps">
          <li><em>01</em><span>Claim your company and load your portfolio.</span></li>
          <li><em>02</em><span>See competitors and the gaps nobody covers.</span></li>
          <li><em>03</em><span>Send a request. We find suppliers and quote.</span></li>
        </ol>
      </div>
    </div>
  );
}
