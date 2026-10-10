import Link from 'next/link';
import type { ReactNode } from 'react';
import type { User } from '@/lib/auth';
import Brand from './Brand';
import NavLinks from './NavLinks';
import CountryPicker from './CountryPicker';
import { signOut } from '@/app/actions/auth';

export default function Shell({ user, title, sub, crumb, actions, children }: {
  user: User; title: ReactNode; sub?: ReactNode; crumb?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
  return (
    <div className="shell">
      <aside className="side">
        <Brand />
        <NavLinks team={user.role === 'team'} />
        <div className="plan-box">
          <b>{user.role === 'team' ? 'Nazryx team' : user.plan === 'paid' ? 'Paid plan' : 'Free plan'}</b>
          {user.plan !== 'paid' && user.role !== 'team' ? (
            <span className="num">{user.credits} enrich credits left</span>
          ) : <span className="hide-m">Unlimited enrich</span>}
          {user.plan !== 'paid' && user.role !== 'team' && <Link className="btn-link hide-m" href="/settings#plan">Upgrade</Link>}
        </div>
        <div className="side-foot">
          <span>{user.email}</span>
          <form action={signOut}><button className="btn-link" type="submit">Sign out</button></form>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            {crumb && <div className="crumb">{crumb}</div>}
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <div className="top-right">
            {actions}
            <CountryPicker user={user} />
            <Link className="avatar" href="/settings" title="Settings">{initials || 'You'}</Link>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
