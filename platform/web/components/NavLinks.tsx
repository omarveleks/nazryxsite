'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tr, type Lang } from '@/lib/i18n';

// The manufacturer area (the distributor side is paused: see distributor/README.md). The team also gets Admin.
const NAV = [
  ['/m', 'Home'], ['/m/inbox', 'Inbox'], ['/m/projects', 'Projects'], ['/m/calendar', 'Calendar'], ['/m/market', 'Market'], ['/m/finder', 'Opportunities'], ['/m/simulator', 'Pricing'], ['/m/products', 'My products'], ['/m/regulatory', 'Regulatory'], ['/m/partners', 'Partners'],
  ['/m/tenders', 'Tenders'], ['/m/ask', 'Ask Nazryx'], ['/m/services', 'Services'], ['/m/plan', 'Plan'], ['/settings', 'Settings'],
] as const;

export default function NavLinks({ team, unread = 0, lang = 'en' }: { team: boolean; unread?: number; lang?: Lang }) {
  const path = usePathname();
  const t = tr(lang);
  const items = team ? [...NAV, ['/admin', 'Admin'] as const] : NAV;
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className={path === href || (href !== '/m' && path.startsWith(href + '/')) ? 'on' : ''}
          aria-current={path === href || (href !== '/m' && path.startsWith(href + '/')) ? 'page' : undefined}>{t(label)}
          {href === '/m/inbox' && unread > 0 && <span className="pill solid" style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 7px' }} aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</Link>
      ))}
    </nav>
  );
}
