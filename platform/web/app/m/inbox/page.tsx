import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash } from '@/components/ui';
import { addTenderWatch, removeTenderWatch } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { rows, withUser } from '@/lib/db';
import { ago } from '@/lib/format';
import { countryName } from '@/lib/mfr';

export const metadata = { title: 'Inbox' };

const KIND: Record<string, [string, string]> = {
  competitor: ['New competitor', 'peach'], registration: ['Registration', 'lav'], tender: ['Tender', 'blue'], price: ['Price moved', 'mint'],
  regulatory: ['Requirement', 'lav'], notice: ['Regulator notice', 'peach'], opportunity: ['Opportunity', 'mint'], deadline: ['Deadline', 'peach'], mention: ['Mention', 'blue'], message: ['Message', 'blue'], lead: ['Hand up', 'mint'], system: ['Nazryx', ''],
};

// What moved while you were away: new competitors, tenders, price moves, requirements and notices, on your molecules
// and in your markets, newest first. Opening the page marks everything read. Watches are managed here too.
export default async function Inbox({ searchParams }: { searchParams: Promise<{ kind?: string; saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    const items = await rows(db, `select i.id, i.kind, i.country, i.title, i.body, i.link, i.created_at, i.read_at, m.inn
        from inbox_items i left join molecules m on m.id = i.molecule_id where i.user_id = $1 and ($2::text is null or i.kind = $2)
        order by i.created_at desc limit 300`, [u.id, sp.kind && sp.kind in KIND ? sp.kind : null]);
    const counts = await rows(db, 'select kind, count(*)::int as n from inbox_items where user_id = $1 group by kind', [u.id]);
    const watches = await rows(db, 'select m.id, m.inn from watches w join molecules m on m.id = w.molecule_id where w.user_id = $1 order by m.inn', [u.id]);
    const terms = await rows(db, 'select term from tender_watches where user_id = $1 order by term', [u.id]);
    await db.query('update inbox_items set read_at = now() where user_id = $1 and read_at is null', [u.id]);
    return { items, counts, watches, terms };
  });
  const total = d.counts.reduce((t, c) => t + c.n, 0);
  const date = (v: string | Date) => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <Shell user={u} title={t('Inbox')} sub={t('What moved in your markets and on your molecules')}>
      <Flash sp={sp} />
      <div className="row" style={{ gap: 6 }}>
        <Link className={`pill ${!sp.kind ? 'solid' : ''}`} href="/m/inbox">All{total ? ` (${total})` : ''}</Link>
        {Object.entries(KIND).filter(([k]) => d.counts.some((c) => c.kind === k)).map(([k, [label]]) => (
          <Link key={k} className={`pill ${sp.kind === k ? 'solid' : ''}`} href={`/m/inbox?kind=${k}`}>{t(label)} ({d.counts.find((c) => c.kind === k)?.n})</Link>))}
      </div>
      <div className="split">
        <section className="card">
          {d.items.length === 0 ? (
            <Empty>{t('Nothing yet. Items arrive within an hour of a change: a new competitor on one of your molecules, a tender, a price that moved, a requirement published in one of your markets. Add products and watches to hear about more.')}</Empty>
          ) : (
            <div>{d.items.map((x, i) => (
              <div key={x.id} className="between" style={{ alignItems: 'flex-start', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--line)' : undefined,
                background: x.read_at ? undefined : 'var(--soft)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 6 }}><span className={`pill ${KIND[x.kind]?.[1] ?? ''}`} style={{ fontSize: 12 }}>{t(KIND[x.kind]?.[0] ?? x.kind)}</span>
                    {x.country && <span className="small muted">{t(countryName(x.country))}</span>}
                    <span className="small muted" title={new Date(x.created_at).toLocaleString('en-GB')}>{ago(x.created_at)}</span></div>
                  <div style={{ marginTop: 4 }}>{x.link ? <Link href={x.link}><b>{x.title}</b></Link> : <b>{x.title}</b>}</div>
                  {x.body && <div className="small muted">{x.body}</div>}
                </div>
                <span className="small muted hide-m">{date(x.created_at)}</span>
              </div>))}</div>)}
        </section>
        <div className="stack">
          <section className="card stack" id="watches">
            <h2>{t('Watches')}</h2>
            <p className="note">{t('Your markets: everything registered, tendered or priced on the molecules you sell. Watch more molecules from any product page, and tender keywords here.')}</p>
            <div><span className="lbl">{t('Molecules watched')}</span>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>{d.watches.length ? d.watches.map((w) => <span key={w.id} className="pill">{w.inn}</span>)
                : <span className="small muted">{t('Only the molecules you sell, so far.')}</span>}</div></div>
            <div><span className="lbl">{t('Tender keywords')}</span>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>{d.terms.map((t) => (
                <form key={t.term} action={removeTenderWatch} className="row" style={{ gap: 2 }}><input type="hidden" name="term" value={t.term} />
                  <span className="pill">{t.term}</span><button className="btn-link x" type="submit" aria-label={`Stop watching ${t.term}`}>×</button></form>))}</div>
              <form action={addTenderWatch} className="row" style={{ marginTop: 8 }}>
                <input className="input" name="term" placeholder="e.g. insulin, oncology, ARV" aria-label={t('Tender keyword')} maxLength={60} required style={{ flex: '1 1 160px' }} />
                <button className="btn btn-ghost btn-sm" type="submit">{t('Watch')}</button></form>
              <span className="note">{t('Any public tender in your markets whose title contains the word lands here.')}</span></div>
          </section>
          <section className="card stack">
            <h2>{t('By email')}</h2>
            <p className="note">{t('Unread items go out once a day as one email')}{u.notify_email ? '' : ` (${t('turned off in Settings')})`}. <Link href="/settings">{t('Settings')}</Link></p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
