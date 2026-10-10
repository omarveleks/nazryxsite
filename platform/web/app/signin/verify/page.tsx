import Brand from '@/components/Brand';
import { verifyTwoStep } from '@/app/actions/auth';

export const metadata = { title: 'Two-step sign-in' };

export default async function Verify({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="wrap-narrow" style={{ maxWidth: 460 }}>
      <Brand href="/signup" />
      <h1>Enter your code</h1>
      <p className="muted">Open your authenticator app and type the 6-digit code for Nazryx.</p>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      <form action={verifyTwoStep} className="stack">
        <div className="field"><label htmlFor="code">6-digit code</label>
          <input className="input" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus /></div>
        <button className="btn btn-blue" type="submit">Sign in</button>
      </form>
      <p className="note">Lost your phone? Ask the Nazryx team to reset two-step sign-in on your account.</p>
    </div>
  );
}
