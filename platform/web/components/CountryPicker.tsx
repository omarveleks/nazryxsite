import Link from 'next/link';
import type { User } from '@/lib/auth';

// Tanzania is the first market. Other markets are shown as coming soon (more countries are a paid feature).
export default function CountryPicker({ user }: { user: User }) {
  return (
    <details className="dd">
      <summary className="btn btn-ghost btn-sm" aria-label="Country">Tanzania ▾</summary>
      <div className="menu">
        <span><b>Tanzania</b><span className="blue">✓</span></span>
        <span className="muted">Kenya <span className="pill">Soon</span></span>
        <span className="muted">Uganda <span className="pill">Soon</span></span>
        {user.plan !== 'paid' && <Link href="/settings#plan">More countries on paid</Link>}
      </div>
    </details>
  );
}
