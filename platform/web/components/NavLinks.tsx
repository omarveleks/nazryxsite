'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The manufacturer area (the distributor side is paused: see distributor/README.md). The team also gets Admin.
const NAV = [
  ['/m', 'Home'], ['/m/market', 'Market'], ['/m/products', 'My products'], ['/m/regulatory', 'Regulatory'], ['/m/partners', 'Partners'], ['/m/services', 'Services'],
  ['/m/plan', 'Plan'], ['/settings', 'Settings'],
] as const;

export default function NavLinks({ team }: { team: boolean }) {
  const path = usePathname();
  const items = team ? [...NAV, ['/admin', 'Admin'] as const] : NAV;
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className={path === href || (href !== '/m' && path.startsWith(href + '/')) ? 'on' : ''}
          aria-current={path === href || (href !== '/m' && path.startsWith(href + '/')) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
