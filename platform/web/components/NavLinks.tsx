'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { tr, type Lang } from '@/lib/i18n';
import NavIcon from './NavIcons';

// The manufacturer area in four groups. The team also gets Admin. Settings sits with the account, under the avatar and in the footer.
type Item = readonly [string, string];
const NAV: readonly (readonly [string, readonly Item[]])[] = [
  ['Today', [['/m', 'Home'], ['/m/inbox', 'Inbox'], ['/m/projects', 'Projects'], ['/m/calendar', 'Calendar']]],
  ['Intelligence', [['/m/market', 'Market'], ['/m/finder', 'Opportunities'], ['/m/simulator', 'Pricing'], ['/m/products', 'My products'], ['/m/regulatory', 'Regulatory']]],
  ['Partners', [['/m/partners', 'Partners'], ['/m/tenders', 'Tenders']]],
  ['Nazryx', [['/m/ask', 'Ask Nazryx'], ['/m/services', 'Services'], ['/m/plan', 'Plan']]],
];

export default function NavLinks({ team, unread = 0, lang = 'en' }: { team: boolean; unread?: number; lang?: Lang }) {
  const path = usePathname();
  const t = tr(lang);
  const ref = useRef<HTMLElement>(null);
  // on a phone the list scrolls sideways: bring the current page into view so the row reads as scrollable
  useEffect(() => {
    const on = ref.current?.querySelector<HTMLElement>('a.on');
    if (on && ref.current && ref.current.scrollWidth > ref.current.clientWidth) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [path]);
  const groups = NAV;
  const items: (readonly [string, readonly Item[]])[] = team ? [...groups, ['', [['/admin', 'Admin']]]] : [...groups];
  const current = (href: string) => path === href || (href !== '/m' && path.startsWith(href + '/'));
  return (
    <nav className="nav" aria-label="Main" ref={ref}>
      {items.map(([group, links], gi) => (
        <div key={group || gi} className="nav" style={{ display: 'contents' }}>
          {group && <span className="nav-h" aria-hidden="true">{t(group)}</span>}
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={current(href) ? 'on' : ''} aria-current={current(href) ? 'page' : undefined}><NavIcon name={label} />{t(label)}
              {href === '/m/inbox' && unread > 0 && <span className="pill solid" style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 7px' }} aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
