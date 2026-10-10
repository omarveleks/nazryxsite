'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  ['/home', 'Home'], ['/search', 'Search'], ['/market', 'Market'], ['/competitors', 'Competitors'],
  ['/portfolio', 'My portfolio'], ['/requests', 'Requests'], ['/settings', 'Settings'],
] as const;

export default function NavLinks({ team }: { team: boolean }) {
  const path = usePathname();
  const items = team ? [...NAV, ['/admin', 'Admin'] as const] : NAV;
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className={path === href || path.startsWith(href + '/') ? 'on' : ''}
          aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
