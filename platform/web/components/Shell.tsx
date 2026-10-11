import Link from 'next/link';
import { MFR_PLANS } from '@/lib/mfr';
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
        <NavLinks team={user.role === 'team'} manufacturer={user.account_type === 'manufacturer'} />
        {user.account_type === 'manufacturer' && user.role !== 'team' ? (
          <div className="plan-box">
            <b>{MFR_PLANS[user.mfr_plan as keyof typeof MFR_PLANS]?.name ?? 'No plan yet'}</b>
            <span className="hide-m">{user.mfr_plan_chosen ? 'Requested' : user.mfr_plan ? 'Suggested for you' : 'Pick the one that fits'}</span>
            <Link className="btn-link hide-m" href="/m/plan">{user.mfr_plan_chosen ? 'Your plan' : 'See plans'}</Link>
          </div>
        ) : (
        <div className="plan-box">
          <b>{user.role === 'team' ? 'Nazryx team' : user.plan === 'paid' ? 'Paid plan' : 'Free plan'}</b>
          {user.plan !== 'paid' && user.role !== 'team' ? (
            <span className="num">{user.credits} enrich credits left</span>
          ) : <span className="hide-m">Unlimited enrich</span>}
          {user.plan !== 'paid' && user.role !== 'team' && <Link className="btn-link hide-m" href="/settings#plan">Upgrade</Link>}
        </div>)}
        <div className="side-foot">
          <Link href="/help">Help and contact</Link>
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
            {user.role !== 'team' && user.account_type !== 'manufacturer' && <Link className={`btn btn-sm ${user.list_count ? 'btn-blue' : 'btn-ghost'}`} href="/requests/list">
              Sourcing list{user.list_count ? ` · ${user.list_count}` : ''}</Link>}
            {user.account_type !== 'manufacturer' && <CountryPicker user={user} />}
            <Link className="avatar" href="/settings" title="Settings">{initials || 'You'}</Link>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
