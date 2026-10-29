import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { rows, withUser } from '@/lib/db';
import { ago } from '@/lib/format';

export const metadata = { title: 'Activity' };
const KIND: Record<string, [string, string]> = { comment: ['Comment', 'lav'], task: ['Task done', 'mint'], project: ['Project', 'blue'], file: ['File', ''], nazryx: ['Nazryx', 'peach'], product: ['Product added', ''] };

// What the team did, newest first: comments, tasks ticked, projects moved, files uploaded, products added, and what Nazryx did.
export default async function Activity() {
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const list = await withUser(u.id, (db) => rows(db, 'select * from account_activity(150)'));
  const byDay = list.reduce<Record<string, typeof list>>((acc, x) => { const k = x.at ? new Date(x.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; (acc[k] ??= []).push(x); return acc; }, {});
  return (
    <Shell user={u} title={t('Activity')} sub={t('What your team and Nazryx did, newest first')} crumb={<><Link href="/m/projects">{t('Projects')}</Link> / {t('Activity')}</>}>
      <section className="card stack">
        {list.length === 0 ? <Empty>{t('Nothing yet. Projects, tasks, comments and uploads show up here as they happen.')}</Empty> : Object.entries(byDay).map(([day, xs]) => (
          <div key={day} className="stack" style={{ gap: 2 }}><span className="lbl">{day}</span>
            {xs.map((x, i) => { const k = KIND[x.kind] ?? [x.kind, '']; return (
              <div key={i} className="between small" style={{ gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ minWidth: 0 }}><span className={`pill ${k[1]}`} style={{ fontSize: 11, marginRight: 8 }}>{t(k[0])}</span>{x.actor && <b>{x.actor} · </b>}<Link href={x.href}>{x.title}</Link></span>
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>{ago(x.at)}</span>
              </div>); })}
          </div>))}
      </section>
    </Shell>
  );
}
