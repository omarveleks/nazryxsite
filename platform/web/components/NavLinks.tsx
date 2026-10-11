'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  ['/home', 'Home'], ['/search', 'Search'], ['/market', 'Market'], ['/competitors', 'Competitors'],
  ['/portfolio', 'My portfolio'], ['/requests', 'Requests'], ['/settings', 'Settings'],
] as const;

// Manufacturer accounts: their own area for expanding into new markets.
const MFR_NAV = [
  ['/m', 'Home'], ['/m/products', 'My products'], ['/m/market', 'Market'], ['/m/partners', 'Partners'], ['/m/services', 'Services'], ['/m/plan', 'Plan'],
  ['/expert', 'Ask the expert'], ['/settings', 'Settings'],
] as const;

export default function NavLinks({ team, manufacturer }: { team: boolean; manufacturer?: boolean }) {
  const path = usePathname();
  const base = manufacturer ? MFR_NAV : NAV;
  const items = team ? [...base, ['/admin', 'Admin'] as const] : base;
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className={path === href || (href !== '/m' && path.startsWith(href + '/')) ? 'on' : ''}
          aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
