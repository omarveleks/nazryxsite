import Link from 'next/link';
import TourBar from './TourBar';
import { MFR_PLANS } from '@/lib/mfr';
import { VerifiedIcon } from './Icons';
import type { ReactNode } from 'react';
import type { User } from '@/lib/auth';
import Brand from './Brand';
import NavLinks from './NavLinks';
import { signOut } from '@/app/actions/auth';

export default function Shell({ user, title, sub, crumb, actions, children }: {
  user: User; title: ReactNode; sub?: ReactNode; crumb?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
  return (
    <div className="shell">
      <aside className="side">
        <Brand />
        <NavLinks team={user.role === 'team'} unread={user.inbox_unread ?? 0} />
        {user.account_type === 'manufacturer' && user.role !== 'team' ? (
          <div className="plan-box">
            <b>{user.mfr_active ? MFR_PLANS[user.mfr_active as keyof typeof MFR_PLANS]?.name : 'No plan yet'}</b>
            <span className="hide-m">{user.mfr_active ? 'Active' : user.mfr_plan_chosen
              ? `${MFR_PLANS[user.mfr_plan as keyof typeof MFR_PLANS]?.name} requested` : 'Some screens are locked'}</span>
            <Link className="btn-link hide-m" href="/m/plan">{user.mfr_active ? 'Your plan' : 'See plans'}</Link>
            {user.mfr_verified && <span className="pill blue hide-m" style={{ alignSelf: 'flex-start' }}><VerifiedIcon /> Verified manufacturer</span>}
          </div>
        ) : user.role === 'team' ? <div className="plan-box"><b>Nazryx team</b></div> : null}
        <div className="side-foot">
          <Link href="/help">Help and contact</Link>
          <span>{user.email}</span>
          <form action={signOut}><button className="btn-link" type="submit">Sign out</button></form>
        </div>
      </aside>
      <main className="main">
        {(user.viewed_by || user.view_ended) && (
          <div className={user.viewed_by ? 'ok' : 'err'} role="status" style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>{user.viewed_by
              ? <>Viewing <b>{user.email}</b> as they see it. Read-only: nothing here can be changed.</>
              : <>Your view of an account has ended. Exit it to make changes again.</>}</span>
            <a className="btn-link" href="/view-as/exit">Exit view</a>
          </div>)}
        <div className="topbar">
          <div>
            {crumb && <div className="crumb">{crumb}</div>}
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <div className="top-right">
            {actions}
            <Link className="avatar" href="/settings" title="Settings">{initials || 'You'}</Link>
          </div>
        </div>
        {user.account_type === 'manufacturer' && user.role !== 'team' && user.tour_step ? <TourBar step={user.tour_step} /> : null}
        {children}
      </main>
    </div>
  );
}
