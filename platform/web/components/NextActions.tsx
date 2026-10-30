import Link from 'next/link';
import { fmtDate } from '@/lib/format';
import type { Action } from '@/lib/next';
import type { T } from '@/lib/i18n';

/** The list on Home: what to do next, most pressing first. A quiet line when nothing is due. */
export default function NextActions({ actions, t }: { actions: Action[]; t: T }) {
  return (
    <section className="card" data-tour="next">
      <div className="card-h" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><div style={{ minWidth: 0 }}><h2>{t('Next actions')}</h2><p className="note">{t('What is due, what stopped moving and what to finish, across your projects and markets.')}</p></div>
        <Link className="btn-link small nowrap" href="/m/calendar">{t('Calendar')}</Link></div>
      {actions.length === 0 ? (
        <div className="empty">{t('All clear. Nothing due in the next two weeks. Open a product to pick its next market.')}</div>
      ) : (
        <div className="actions">{actions.map((a, i) => (
          <Link key={i} href={a.href} className={`action u${a.urgency}`}>
            <i aria-hidden="true" />
            <span className="action-t">{t(a.key, a.vars)}</span>
            <span className="small muted num nowrap">{a.when ? fmtDate(a.when) : '→'}</span>
          </Link>))}</div>)}
    </section>
  );
}
