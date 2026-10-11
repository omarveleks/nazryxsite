import Link from 'next/link';
import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import { getUser } from '@/lib/auth';
import { signIn, signUp } from '@/app/actions/auth';

export const metadata = { title: 'Sign up' };

type Side = 'distributor' | 'manufacturer';
const SIDES: Record<Side, { label: string; line: string; tile: string; head: string; sub: string; steps: string[] }> = {
  distributor: {
    label: 'I’m a distributor', line: 'Distributors and importers: find open molecules, source them, analyse your portfolio.', tile: 't-blue',
    head: 'You know your products. We show you the market.', sub: 'Every registered competitor, every open gap, and a team that sources what you need.',
    steps: ['Claim your company and load your portfolio.', 'See competitors and the gaps nobody covers.', 'Send a request. We find suppliers and quote.'],
  },
  manufacturer: {
    label: 'I’m a manufacturer', line: 'Manufacturers: take your products into new markets, with our team on the ground.', tile: 't-mint',
    head: 'You make medicines. We open the markets.', sub: 'Market data, partners and registration in Tanzania, Kenya, Kazakhstan, Uzbekistan, Cameroon and Senegal.',
    steps: ['Tell us your company, markets and catalogue.', 'See which products to register first, and why.', 'We find the partner and take you through registration.'],
  },
};

export default async function SignUp({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string; as?: string }> }) {
  const sp = await searchParams;
  if (await getUser()) redirect('/home');
  const signin = sp.mode === 'signin';
  const side: Side | null = sp.as === 'manufacturer' || sp.as === 'distributor' ? sp.as : null;
  const s = side ? SIDES[side] : null;
  const href = (as: Side | null, mode = signin ? 'signin' : '') => {
    const q = new URLSearchParams();
    if (mode) q.set('mode', mode);
    if (as) q.set('as', as);
    return `/signup${q.size ? `?${q}` : ''}`;
  };
  return (
    <div className="auth">
      <div className="auth-l">
        <Brand href="/signup" />
        <div>
          <h1>{signin ? 'Welcome back' : side === 'manufacturer' ? 'Take your products further.' : 'See your market. Fill the gaps.'}</h1>
          <p className="muted" style={{ marginTop: 10 }}>Bridging the gap in medical trade across frontier markets.</p>
        </div>
        <div className="tabs" role="tablist">
          <Link href={href(side, '')} className={!signin ? 'on' : ''}>Create account</Link>
          <Link href={href(side, 'signin')} className={signin ? 'on' : ''}>Sign in</Link>
        </div>
        {sp.error && <div className="err" role="alert">{sp.error}</div>}
        {!side ? (
          <div className="stack" style={{ gap: 12 }}>
            <p className="lbl">{signin ? 'Sign in as' : 'How will you use Nazryx?'}</p>
            {(Object.keys(SIDES) as Side[]).map((k) => (
              <Link key={k} href={href(k)} className={`tile ${SIDES[k].tile}`} style={{ padding: '22px 22px' }}>
                <span className="v" style={{ fontSize: 24 }}>{SIDES[k].label}</span>
                <span>{SIDES[k].line}</span>
                <span className="k">{signin ? 'Sign in' : 'Create account'} →</span>
              </Link>))}
          </div>
        ) : (<>
          <div className={`tile ${s!.tile}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="k">{s!.label}</span><Link href={href(null)} className="small">Change</Link>
          </div>
          {signin ? (
            <form action={signIn} className="stack">
              <input type="hidden" name="account_type" value={side} />
              <div className="field"><label htmlFor="email">Work email</label>
                <input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" /></div>
              <div className="field"><label htmlFor="password">Password</label>
                <input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
              <button className="btn btn-blue" type="submit">Sign in</button>
            </form>
          ) : (
            <form action={signUp} className="stack">
              <input type="hidden" name="account_type" value={side} />
              <div className="field"><label htmlFor="name">Full name</label>
                <input className="input" id="name" name="name" autoComplete="name" required placeholder="Full name" /></div>
              <div className="field"><label htmlFor="email">Work email</label>
                <input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" /></div>
              <div className="field"><label htmlFor="password">Password</label>
                <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required placeholder="At least 10 characters" /></div>
              <button className="btn btn-blue" type="submit">Create account</button>
              <p className="note">{side === 'manufacturer'
                ? 'Next: a few questions about your company, markets and catalogue (about 5 minutes). We then suggest the right plan.'
                : 'Free plan: 1 country, no card needed. Your work email domain helps us verify your company in the next step.'}</p>
            </form>
          )}
        </>)}
      </div>
      <div className="auth-r">
        <h2>{s ? s.head : 'Medicines, registered where they are needed.'}</h2>
        <p>{s ? s.sub : 'Distributors find and source what their market lacks. Manufacturers get their products registered and sold there.'}</p>
        <ol className="steps">
          {(s ? s.steps : ['Pick your side: distributor or manufacturer.', 'Tell us what you do and where.', 'Get the market picture and a team that acts on it.'])
            .map((t, i) => <li key={i}><em>0{i + 1}</em><span>{t}</span></li>)}
        </ol>
      </div>
    </div>
  );
}
