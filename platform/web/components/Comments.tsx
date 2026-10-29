import { addComment, deleteComment } from '@/app/actions/collab';
import { tt } from '@/lib/i18n';
import { ago } from '@/lib/format';
import type { Db } from '@/lib/db';
import { rows } from '@/lib/db';

export type Comment = { id: number; body: string; created_at: string; author: string | null; author_id: string | null };

export async function loadComments(db: Db, kind: string, target: string): Promise<Comment[]> {
  return rows(db, `select c.id, c.body, c.created_at, coalesce(a.name, a.email) as author, c.author_id from comments c left join users a on a.id = c.author_id
      where c.target_kind = $1 and c.target_id = $2 order by c.created_at`, [kind, target]);
}

/** Comments and mentions on a product, project, molecule, tender or company: the team talks where the data is. */
export default function Comments({ kind, target, list, here, me, seats, canWrite = true }: {
  kind: string; target: string; list: Comment[]; here: string; me: string; seats: { id: string; name: string | null; email: string }[]; canWrite?: boolean;
}) {
  const t = tt();
  const names = seats.filter((s) => s.id !== me && s.name).map((s) => '@' + s.name!.split(/\s+/)[0]);
  return (
    <section className="card stack" id="comments">
      <div className="card-h"><h2>{t('Notes and comments')}</h2><span className="note">{list.length ? t('{n} so far', { n: list.length }) : ''}</span></div>
      {list.length === 0 && <p className="note">{t('Nothing yet. Leave a note for your team here; mention a colleague with @ and it lands in their inbox.')}</p>}
      {list.map((c) => (
        <div key={c.id} className="between" style={{ alignItems: 'flex-start', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ minWidth: 0 }}><span className="small"><b>{c.author ?? t('Someone')}</b> <span className="muted">· {ago(c.created_at)}</span></span><div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div></div>
          {c.author_id === me && <form action={deleteComment}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="return" value={here} /><button className="btn-link small" type="submit" aria-label={t('Delete comment')}>×</button></form>}
        </div>))}
      {canWrite && (
        <form action={addComment} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="target" value={target} /><input type="hidden" name="return" value={here} />
          <textarea className="input" name="body" rows={2} maxLength={2000} placeholder={names.length ? t('Write a note… mention {names}', { names: names.slice(0, 3).join(', ') }) : t('Write a note for your team')} aria-label={t('Comment')} required />
          <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>{t('Post')}</button>
        </form>)}
    </section>
  );
}
