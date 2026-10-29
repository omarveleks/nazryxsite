import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { loadThreads, ThreadList } from '@/components/Threads';
import { setNeedStatus } from '@/app/actions/market';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, withUser } from '@/lib/db';
import { ago, fmtDate } from '@/lib/format';
import { countryName } from '@/lib/mfr';

// One need: what was asked, the manufacturers who raised a hand (each a conversation), and its status.
export default async function Need({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const u = await requireUser({ distributor: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => ({
    n: await one(db, 'select n.*, coalesce(m.inn, n.molecule_text) as name from needs n left join molecules m on m.id = n.molecule_id where n.id = $1 and n.user_id = $2', [id, u.id]),
    threads: (await loadThreads(db)).filter((x) => x.need_id === id),
  }));
  if (!d.n) notFound();
  const n = d.n;
  return (
    <Shell user={u} title={n.name} sub={`${t(countryName(n.country))}${n.dosage_form ? ` · ${n.dosage_form}` : ''} · ${t('posted')} ${ago(n.created_at)}`}
      crumb={<Link href="/d/needs">{t('My needs')}</Link>}>
      <Flash sp={sp} />
      <div className="split">
        <div className="stack">
          <div className="card-h"><h2>{t('Hands up')} ({d.threads.length})</h2></div>
          {d.threads.length === 0 ? <section className="card"><p className="note">{t('No manufacturer has answered yet. Needs on the board reach every manufacturer on Nazryx with that market; the team also brings in the right ones.')}</p></section>
            : <ThreadList list={d.threads} base="/d/threads" />}
        </div>
        <div className="stack">
          <section className="card stack">
            <h2>{t('The need')}</h2>
            <dl className="facts">
              {n.quantity && <><dt>{t('Quantity')}</dt><dd>{n.quantity}</dd></>}
              {n.target_price && <><dt>{t('Price in mind')}</dt><dd>{n.target_price}</dd></>}
              {n.deliver_by && <><dt>{t('Needed by')}</dt><dd>{fmtDate(n.deliver_by)}</dd></>}
              <dt>{t('Status')}</dt><dd><span className={`pill ${n.status === 'open' ? 'mint' : n.status === 'matched' ? 'blue' : ''}`}>{t(n.status)}</span></dd>
            </dl>
            {n.note && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{n.note}</p>}
          </section>
          <section className="card stack">
            <h2>{t('Update')}</h2>
            <form action={setNeedStatus} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="id" value={n.id} />
              <select className="input" name="status" defaultValue={n.status} aria-label={t('Status')} style={{ minHeight: 34, fontSize: 13 }}>
                <option value="open">{t('open')}</option><option value="matched">{t('matched')}</option><option value="closed">{t('closed')}</option></select>
              <button className="btn btn-ghost btn-sm" type="submit">{t('Save')}</button>
            </form>
            <p className="note">{t('Matched: you found your supplier. Closed: no longer needed. Either takes it off the board.')}</p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
