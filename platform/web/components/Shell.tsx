import Link from 'next/link';
import { cookies } from 'next/headers';
import { MenuButton, NavToggle } from './NavToggle';
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

export default async function Shell({ user, title, sub, crumb, actions, help, children }: {
  user: User; title: ReactNode; sub?: ReactNode; crumb?: ReactNode; actions?: ReactNode; help?: ReactNode; children: ReactNode;
}) {
  const t = tt();
  const collapsed = (await cookies()).get('nzx_nav')?.value === 'collapsed';
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
  const account = (
    <Link className="account" href="/settings" title={t('Settings')}>
      <span className="avatar" aria-hidden="true">{initials || t('You')}</span>
      <span className="who"><b>{user.name || user.company_name || t('Your account')}</b><span>{user.email}</span></span>
    </Link>);
  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`} id="shell">
      <a className="skip" href="#main">{t('Skip to content')}</a>
      <header className="m-bar">
        <MenuButton open={t('Open menu')} close={t('Close menu')} />
        <Brand />
        <Link className="avatar" href="/settings" aria-label={t('Settings')} style={{ marginLeft: 'auto', width: 36, height: 36, fontSize: 13 }}>{initials || t('You')}</Link>
      </header>
      <aside className="side" id="sidenav" aria-label={t('Navigation')}>
        <div className="side-top">
          <Brand />
          <NavToggle hide={t('Hide navigation')} show={t('Show navigation')} />
          <MenuButton open={t('Open menu')} close={t('Close menu')} variant="close" />
        </div>
        <NavLinks team={user.role === 'team'} unread={user.inbox_unread ?? 0} lang={curLang()} />
        {user.account_type === 'manufacturer' && user.role !== 'team' ? (
          <div className="plan-box">
            <div className="between" style={{ gap: 8 }}><b>{user.mfr_active ? t(MFR_PLANS[user.mfr_active as keyof typeof MFR_PLANS]?.name) : t('No plan yet')}</b>
              {user.mfr_verified && <VerifiedIcon title={t('Verified manufacturer')} />}</div>
            <span>{user.mfr_active ? t('Active') : user.mfr_plan_chosen
              ? t('{plan} requested', { plan: t(MFR_PLANS[user.mfr_plan as keyof typeof MFR_PLANS]?.name) }) : t('Some screens are locked')}</span>
            <Link className="btn-link" href="/m/plan">{user.mfr_active ? t('Your plan') : t('See plans')}</Link>
          </div>
        ) : user.role === 'team' ? <div className="plan-box"><b>{t('Nazryx team')}</b></div>
        : null}
        <div className="side-foot">
          {account}
          <div className="foot-links">
            <Link href="/settings">{t('Settings')}</Link>
            <Link href="/help">{t('Help')}</Link>
            <form action={signOut}><button className="btn-link" type="submit">{t('Sign out')}</button></form>
          </div>
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
        <header className="topbar">
          <div className="title">
            {crumb && <div className="crumb">{crumb}</div>}
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {((user.account_type === 'manufacturer' || user.role === 'team') || actions) && (
            <div className="top-right">
              {(user.account_type === 'manufacturer' || user.role === 'team') && <SearchBox lang={curLang()} />}
              {actions}
            </div>)}
        </header>
        {help && <details className="explain"><summary>{t('How to use this page')}</summary><p>{help}</p></details>}
        {user.account_type === 'manufacturer' && user.role !== 'team' && user.tour_step ? <TourBar step={user.tour_step} /> : null}
        {children}
      </main>
    </div>
  );
}
