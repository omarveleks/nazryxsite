import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash } from '@/components/ui';
import { askExpert } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Ask the expert' };

// A short question to the Nazryx team, without opening a full request. Free plans: 3 a month.
export default async function Expert({ searchParams }: { searchParams: Promise<{ molecule?: string; error?: string; sent?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const free = u.plan !== 'paid' && u.role !== 'team';
  const d = await withUser(u.id, async (db) => ({
    mol: sp.molecule ? await one(db, 'select id, inn from molecules where id = $1', [Number(sp.molecule) || 0]) : null,
    qs: await rows(db, `select q.id, q.body, q.answer, q.answered_at, q.created_at, q.molecule_id, m.inn
                        from expert_questions q left join molecules m on m.id = q.molecule_id where q.user_id = $1 order by q.created_at desc`, [u.id]),
    used: Number((await one(db, `select count(*)::int as n from expert_questions where user_id = $1 and created_at > now() - interval '30 days'`, [u.id]))?.n ?? 0),
    names: await rows(db, `select m.inn from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = $1
                           order by cm.on_national_list desc, m.inn limit 2000`, [COUNTRY]),
  }));
  const left = free ? Math.max(0, 3 - d.used) : null;
  return (
    <Shell user={u} title="Ask the expert" sub="Regulatory, pricing or sourcing questions, answered by our team">
      <Flash sp={sp} />
      {sp.sent && <div className="ok" role="status">Question sent. We usually answer within two working days, here and by email.</div>}
      <div className="split">
        <section className="card">
          <div className="card-h"><h2>Your questions</h2></div>
          {d.qs.length === 0 && <Empty>No questions yet. Ask about a molecule&apos;s registration route, likely price, or who could supply it.</Empty>}
          <div className="stack" style={{ gap: 14 }}>{d.qs.map((q, i) => (
            <div key={q.id} className="stack" style={{ gap: 6, paddingTop: i ? 14 : 0, borderTop: i ? '1px solid var(--line)' : undefined }}>
              <div className="between"><span className="sub2">{q.inn ? <Link href={`/molecule/${q.molecule_id}`}>{q.inn}</Link> : 'General'} · {fmtDate(q.created_at)}</span>
                <span className={`pill ${q.answer ? 'mint' : 'peach'}`}>{q.answer ? 'Answered' : 'Waiting'}</span></div>
              <div className="msg me"><b>You:</b> {q.body}</div>
              {q.answer && <div className="msg team"><b>Nazryx:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{q.answer}</span>
                <div className="tiny muted">{fmtDate(q.answered_at)}</div></div>}
              {q.answer && q.molecule_id && <div className="row"><Link className="btn btn-blue btn-sm" href={`/requests/new?molecule=${q.molecule_id}`}>Turn into a request</Link></div>}
            </div>))}</div>
        </section>
        <section className="card stack">
          <h2>New question</h2>
          {left === 0 ? (
            <div className="locked"><b>You have used your 3 free questions this month.</b>
              <span className="note">Paid plans ask without limits.</span><Link className="btn btn-ghost btn-sm" href="/settings#plan">Upgrade</Link></div>
          ) : (
            <form action={askExpert} className="stack">
              <div className="field"><label htmlFor="molecule">Molecule (optional)</label>
                <input className="input" id="molecule" name="molecule" list="ex-mols" defaultValue={d.mol?.inn ?? ''} placeholder="Any molecule, or leave empty" autoComplete="off" />
                <datalist id="ex-mols">{d.names.map((n) => <option key={n.inn} value={n.inn} />)}</datalist></div>
              <div className="field"><label htmlFor="body">Your question</label>
                <textarea className="input" id="body" name="body" required rows={5} placeholder="e.g. Can this be registered through the abridged route, and how long would it take?" /></div>
              <button className="btn btn-blue" type="submit">Send question</button>
              {left !== null && <span className="note">{left} of 3 free questions left this month.</span>}
            </form>)}
        </section>
      </div>
    </Shell>
  );
}
