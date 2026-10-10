import QRCode from 'qrcode';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { confirmTwoStep, disableTwoStep, startTwoStep } from '@/app/actions/security';
import { requireUser, teamTwoStepRequired } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { otpauthUri } from '@/lib/totp';

export const metadata = { title: 'Two-step sign-in' };

export default async function Security({ searchParams }: { searchParams: Promise<{ error?: string; required?: string; on?: string; off?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ allowOnboarding: true });
  const row = await withUser(u.id, (db) => one(db, 'select secret, enabled from user_totp where user_id = $1', [u.id]));
  const pending = row && !row.enabled;
  const qr = pending ? await QRCode.toString(otpauthUri(row.secret, u.email), { type: 'svg', margin: 1, width: 200 }) : null;
  const mustKeep = u.role === 'team' && teamTwoStepRequired();
  return (
    <Shell user={u} title="Two-step sign-in" crumb={<><Link href="/settings">Settings</Link> / Two-step sign-in</>}
      sub="A 6-digit code from your phone, on top of your password">
      {sp.required && !row?.enabled && <div className="err" role="alert">Team accounts need two-step sign-in before Admin opens. Set it up below.</div>}
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      {sp.on && <div className="ok" role="status">Two-step sign-in is on. You&apos;ll be asked for a code each time you sign in.</div>}
      {sp.off && <div className="ok" role="status">Two-step sign-in is off.</div>}
      <section className="card stack" style={{ maxWidth: 640 }}>
        {row?.enabled ? (<>
          <div className="between"><h2>Two-step sign-in is on</h2><span className="pill mint">On</span></div>
          {mustKeep ? <p className="note">Team accounts keep it on. If you lose your phone, another team member can reset it on Admin › Accounts.</p> : (
            <form action={disableTwoStep} className="row">
              <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="Current 6-digit code" aria-label="Current code" required style={{ flex: '1 1 200px' }} />
              <button className="btn btn-ghost btn-sm" type="submit">Turn off</button>
            </form>)}
        </>) : pending ? (<>
          <h2>Scan this with your authenticator app</h2>
          <ol className="steps">
            <li><em>01</em><span>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar).</span></li>
            <li><em>02</em><span>Add an account and scan the code. If you can&apos;t scan, type this key: <code className="num" style={{ overflowWrap: 'anywhere' }}>{row.secret.replace(/(.{4})/g, '$1 ').trim()}</code></span></li>
            <li><em>03</em><span>Enter the 6-digit code the app shows.</span></li>
          </ol>
          <div style={{ width: 200, maxWidth: '100%', background: '#fff', padding: 8, borderRadius: 12, border: '1px solid var(--line)' }}
            role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: qr! }} />
          <form action={confirmTwoStep} className="row">
            <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" aria-label="6-digit code" required style={{ flex: '1 1 200px' }} />
            <button className="btn btn-blue" type="submit">Turn on</button>
          </form>
        </>) : (<>
          <h2>Protect your account</h2>
          <p className="muted">After your password, you&apos;ll type a code from an authenticator app on your phone. Someone who learns your password still can&apos;t sign in.</p>
          <form action={startTwoStep}><button className="btn btn-blue" type="submit">Set up two-step sign-in</button></form>
        </>)}
      </section>
    </Shell>
  );
}
