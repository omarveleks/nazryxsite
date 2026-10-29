import Link from 'next/link';
import { postMessage } from '@/app/actions/market';
import { VerifiedIcon } from './Icons';
import { Empty } from './ui';
import { tt } from '@/lib/i18n';
import { ago } from '@/lib/format';
import { countryName } from '@/lib/mfr';
import type { Db } from '@/lib/db';
import { rows } from '@/lib/db';

export type ThreadRow = { id: number; need_id: number | null; subject: string; last_at: string; unread: boolean; other_name: string; other_verified: boolean; other_side: string; country: string | null; last_body: string | null };
export type Msg = { id: number; body: string; created_at: string; from_team: boolean; mine: boolean; who: string };

export const loadThreads = (db: Db) => rows<ThreadRow>(db, 'select * from thread_list()');
export async function loadThread(db: Db, id: number) {
  const list = await loadThreads(db);
  const head = list.find((t) => t.id === id) ?? null;
  const msgs = head ? await rows<Msg>(db, 'select * from thread_messages_of($1)', [id]) : [];
  if (head) await db.query('select thread_seen($1)', [id]);
  return { head, msgs };
}

/** Every conversation this account is in, newest first; unread ones in bold. */
export function ThreadList({ list, base }: { list: ThreadRow[]; base: '/m/threads' | '/d/threads' }) {
  const t = tt();
  if (list.length === 0) return <section className="card"><Empty>{t('No conversations yet. They start from a request on the board, or from a manufacturer’s page.')}</Empty></section>;
  return (
    <section className="card stack" style={{ gap: 0 }}>
      {list.map((x) => (
        <Link key={x.id} href={`${base}/${x.id}`} className="between" style={{ gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}><b style={{ fontWeight: x.unread ? 700 : 500 }}>{x.other_name}</b>{x.other_verified && <span className="pill blue" style={{ fontSize: 11 }}><VerifiedIcon /> {t('Verified')}</span>}
              <span className="sub2">· {x.subject}{x.country ? ` · ${t(countryName(x.country))}` : ''}</span></div>
            {x.last_body && <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.last_body}</div>}
          </div>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{x.unread && <span className="pill solid" style={{ fontSize: 11, marginRight: 6 }}>{t('New')}</span>}{ago(x.last_at)}</span>
        </Link>))}
    </section>
  );
}

/** One conversation: the messages, who wrote each, and the reply box. Nazryx messages are marked. */
export function ThreadView({ head, msgs, canWrite = true }: { head: ThreadRow; msgs: Msg[]; canWrite?: boolean }) {
  const t = tt();
  return (
    <section className="card stack">
      <div className="card-h"><h2>{head.other_name}{head.other_verified && <span className="pill blue" style={{ fontSize: 11, marginLeft: 8 }}><VerifiedIcon /> {t('Verified')}</span>}</h2>
        <span className="note">{head.other_side === 'manufacturer' ? t('Manufacturer') : t('Distributor')}</span></div>
      <div className="stack" style={{ gap: 8 }}>
        {msgs.map((m) => (
          <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.from_team ? 'var(--pastel-lav)' : m.mine ? 'var(--pastel-blue)' : 'var(--ground)', borderRadius: 'var(--r-sm)', padding: '8px 12px' }}>
            <div className="small"><b>{m.mine ? t('You') : m.who}</b> <span className="muted">· {ago(m.created_at)}</span></div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
          </div>))}
        <span id="end" />
      </div>
      {canWrite ? (
        <form action={postMessage} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="thread_id" value={head.id} />
          <textarea className="input" name="body" rows={3} maxLength={4000} placeholder={t('Write a reply')} aria-label={t('Reply')} required />
          <div className="between"><span className="note">{t('Nazryx reads along and steps in when it helps: samples, documents, a call.')}</span><button className="btn btn-blue btn-sm" type="submit">{t('Send')}</button></div>
        </form>) : <p className="note">{t('Viewers read; ask your account owner for a sales seat to reply.')}</p>}
    </section>
  );
}
