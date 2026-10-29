import Link from 'next/link';
import { curLang, tt } from '@/lib/i18n';
import TourBar from './TourBar';
import { MFR_PLANS } from '@/lib/mfr';
import { VerifiedIcon } from './Icons';
import type { ReactNode } from 'react';
import type { User } from '@/lib/auth';
import Brand from './Brand';
import NavLinks from './NavLinks';
import SearchBox from './SearchBox';
import { signOut } from '@/app/actions/auth';

export default function Shell({ user, title, sub, crumb, actions, children }: {
  user: User; title: ReactNode; sub?: ReactNode; crumb?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const t = tt();
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
  return (
    <div className="shell">
      <a className="skip" href="#main">{t('Skip to content')}</a>
      <aside className="side">
        <Brand />
        <NavLinks team={user.role === 'team'} unread={user.inbox_unread ?? 0} lang={curLang()} side={user.account_type === 'distributor' && user.role !== 'team' ? 'd' : 'm'} />
        {user.account_type === 'manufacturer' && user.role !== 'team' ? (
          <div className="plan-box">
            <b>{user.mfr_active ? t(MFR_PLANS[user.mfr_active as keyof typeof MFR_PLANS]?.name) : t('No plan yet')}</b>
            <span className="hide-m">{user.mfr_active ? t('Active') : user.mfr_plan_chosen
              ? t('{plan} requested', { plan: t(MFR_PLANS[user.mfr_plan as keyof typeof MFR_PLANS]?.name) }) : t('Some screens are locked')}</span>
            <Link className="btn-link hide-m" href="/m/plan">{user.mfr_active ? t('Your plan') : t('See plans')}</Link>
            {user.mfr_verified && <span className="pill blue hide-m" style={{ alignSelf: 'flex-start' }}><VerifiedIcon /> {t('Verified manufacturer')}</span>}
          </div>
        ) : user.role === 'team' ? <div className="plan-box"><b>{t('Nazryx team')}</b></div>
        : user.account_type === 'distributor' ? (
          <div className="plan-box">
            <b>{user.dist_company ?? t('Distributor')}</b>
            <span className="hide-m">{t('Free account')}</span>
            {user.dist_verified ? <span className="pill blue hide-m" style={{ alignSelf: 'flex-start' }}><VerifiedIcon /> {t('Verified distributor')}</span>
              : <Link className="btn-link hide-m" href="/d/onboarding">{t('Get verified')}</Link>}
          </div>) : null}
        <div className="side-foot">
          {user.account_type !== 'distributor' && <Link href="/settings">{t('Settings')}</Link>}
          <Link href="/help">{t('Help and contact')}</Link>
          <span>{user.email}</span>
          <form action={signOut}><button className="btn-link" type="submit">{t('Sign out')}</button></form>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        {(user.viewed_by || user.view_ended) && (
          <div className={user.viewed_by ? 'ok' : 'err'} role="status" style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>{user.viewed_by
              ? <>{t('Viewing')} <b>{user.email}</b> {t('as they see it. Read-only: nothing here can be changed.')}</>
              : <>{t('Your view of an account has ended. Exit it to make changes again.')}</>}</span>
            <a className="btn-link" href="/view-as/exit">{t('Exit view')}</a>
          </div>)}
        <div className="topbar">
          <div>
            {crumb && <div className="crumb">{crumb}</div>}
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <div className="top-right">
            {(user.account_type === 'manufacturer' || user.role === 'team') && <SearchBox lang={curLang()} />}
            {actions}
            <Link className="avatar" href="/settings" title={t('Settings')}>{initials || t('You')}</Link>
          </div>
        </div>
        {user.account_type === 'manufacturer' && user.role !== 'team' && user.tour_step ? <TourBar step={user.tour_step} /> : null}
        {children}
      </main>
    </div>
  );
}
