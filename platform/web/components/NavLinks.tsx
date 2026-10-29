'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tr, type Lang } from '@/lib/i18n';

// The manufacturer area, or the distributor area. The team also gets Admin.
const NAV = [
  ['/m', 'Home'], ['/m/inbox', 'Inbox'], ['/m/projects', 'Projects'], ['/m/calendar', 'Calendar'], ['/m/market', 'Market'], ['/m/finder', 'Opportunities'], ['/m/simulator', 'Pricing'], ['/m/products', 'My products'], ['/m/regulatory', 'Regulatory'], ['/m/partners', 'Partners'],
  ['/m/tenders', 'Tenders'], ['/m/rfq', 'Requests'], ['/m/threads', 'Messages'], ['/m/ask', 'Ask Nazryx'], ['/m/services', 'Services'], ['/m/plan', 'Plan'], ['/settings', 'Settings'],
] as const;
const DIST_NAV = [
  ['/d', 'Home'], ['/d/needs', 'My needs'], ['/d/makers', 'Manufacturers'], ['/d/threads', 'Messages'], ['/settings', 'Settings'],
] as const;

export default function NavLinks({ team, unread = 0, lang = 'en', side = 'm' }: { team: boolean; unread?: number; lang?: Lang; side?: 'm' | 'd' }) {
  const path = usePathname();
  const t = tr(lang);
  const base: readonly (readonly [string, string])[] = side === 'd' ? DIST_NAV : NAV;
  const items = team ? [...base, ['/admin', 'Admin'] as const] : base;
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className={path === href || (href !== '/m' && href !== '/d' && path.startsWith(href + '/')) ? 'on' : ''}
          aria-current={path === href || (href !== '/m' && href !== '/d' && path.startsWith(href + '/')) ? 'page' : undefined}>{t(label)}
          {(href === '/m/inbox' || href === '/d') && unread > 0 && <span className="pill solid" style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 7px' }} aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</Link>
      ))}
    </nav>
  );
}
