import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty } from '@/components/ui';
import { loadThreads, ThreadList } from '@/components/Threads';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { rows, withUser } from '@/lib/db';
import { ago } from '@/lib/format';
import { countryName } from '@/lib/mfr';

export const metadata = { title: 'Home' };

// The distributor's home: what moved (leads, messages), open needs, and the conversations.
export default async function DistHome() {
  const u = await requireUser({ distributor: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    const items = await rows(db, `select id, kind, title, body, link, created_at, read_at from inbox_items where user_id = $1 order by created_at desc limit 20`, [u.id]);
    await db.query('update inbox_items set read_at = now() where user_id = $1 and read_at is null', [u.id]);
    return {
      items,
      needs: await rows(db, `select n.id, n.country, coalesce(m.inn, n.molecule_text) as name, n.quantity, n.deliver_by, n.status, n.created_at,
          (select count(*)::int from leads l where l.need_id = n.id) as leads from needs n left join molecules m on m.id = n.molecule_id where n.user_id = $1 order by n.created_at desc limit 8`, [u.id]),
      threads: (await loadThreads(db)).slice(0, 6),
    };
  });
  return (
    <Shell user={u} title={u.dist_company ?? t('Home')} sub={t('Your needs, the manufacturers who answered, and your conversations')}
      actions={<Link className="btn btn-blue btn-sm" href="/d/needs#new">{t('Post a need')}</Link>}>
      <div className="split">
        <div className="stack">
          <section className="card stack">
            <div className="card-h"><h2>{t('Your needs')}</h2><Link className="btn-link" href="/d/needs">{t('All')}</Link></div>
            {d.needs.length === 0 ? <Empty>{t('No need posted yet. Post one and the manufacturers who can supply it raise a hand.')}</Empty> : (
              <div className="tbl-wrap" tabIndex={0}><table className="tbl">
                <thead><tr><th>{t('Product')}</th><th>{t('Market')}</th><th className="hide-m">{t('Quantity')}</th><th className="r">{t('Hands up')}</th></tr></thead>
                <tbody>{d.needs.map((n) => <tr key={n.id}><td><Link href={`/d/needs/${n.id}`}><b>{n.name}</b></Link>{n.status !== 'open' && <span className="pill" style={{ marginLeft: 6, fontSize: 11 }}>{t(n.status)}</span>}</td>
                  <td>{t(countryName(n.country))}</td><td className="hide-m small">{n.quantity ?? ''}</td><td className="r num">{n.leads}</td></tr>)}</tbody></table></div>)}
          </section>
          <div className="card-h"><h2>{t('Conversations')}</h2><Link className="btn-link" href="/d/threads">{t('All')}</Link></div>
          <ThreadList list={d.threads} base="/d/threads" />
        </div>
        <div className="stack">
          <section className="card stack">
            <h2>{t('What moved')}</h2>
            {d.items.length === 0 ? <p className="note">{t('Nothing yet. When a manufacturer raises a hand or writes, it shows here.')}</p>
              : d.items.map((x) => <Link key={x.id} href={x.link ?? '/d/threads'} className="small" style={{ display: 'block', fontWeight: x.read_at ? 400 : 600 }}>{x.title}<span className="sub2" style={{ display: 'block' }}>{x.body ? x.body.slice(0, 90) + ' · ' : ''}{ago(x.created_at)}</span></Link>)}
          </section>
          <section className="card stack">
            <h2>{t('Find manufacturers')}</h2>
            <p className="note">{t('Verified and audited manufacturers with their registrations in your markets. Write to them here.')}</p>
            <Link className="btn btn-ghost btn-sm" href="/d/makers" style={{ alignSelf: 'flex-start' }}>{t('Browse manufacturers')}</Link>
          </section>
        </div>
      </div>
    </Shell>
  );
}
