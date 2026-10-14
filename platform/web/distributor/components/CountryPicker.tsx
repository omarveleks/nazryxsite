'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Tanzania is the first market. Other markets are shown as coming soon (more countries are a paid feature).
// The manufacturer side has its own market switch, so this one stays off there (the team sees both sides).
export default function CountryPicker({ paid }: { paid: boolean }) {
  const path = usePathname() ?? '';
  if (path === '/m' || path.startsWith('/m/')) return null;
  return (
    <details className="dd">
      <summary className="btn btn-ghost btn-sm" aria-label="Country">Tanzania ▾</summary>
      <div className="menu">
        <span><b>Tanzania</b><span className="blue">✓</span></span>
        <span className="muted">Kenya <span className="pill">Soon</span></span>
        <span className="muted">Uganda <span className="pill">Soon</span></span>
        {!paid && <Link href="/settings#plan">More countries on paid</Link>}
      </div>
    </details>
  );
}
