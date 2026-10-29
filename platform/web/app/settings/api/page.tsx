import Link from 'next/link';
import Shell from '@/components/Shell';
import { Flash, PlanLock } from '@/components/ui';
import { createApiKey, revokeApiKey } from '@/app/actions/projects';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { canUse } from '@/lib/mfr';

export const metadata = { title: 'API' };

// Keys for the read API, and what it answers. Complete Market Access and up.
export default async function ApiSettings({ searchParams }: { searchParams: Promise<{ created?: string; saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const keys = await withUser(u.id, (db) => rows(db, 'select id, name, prefix, created_at, last_used_at, revoked_at from api_keys where user_id = $1 order by created_at desc', [u.id]));
  const ok = canUse(u.mfr_tier, 'distributors');
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://nazryx-web.onrender.com';
  return (
    <Shell user={u} title={t('API')} sub={t('Read what the portal knows from your own systems')} crumb={<><Link href="/settings">{t('Settings')}</Link> / API</>}>
      <Flash sp={sp} />
      {sp.created && <div className="ok" role="status"><b>{t('Your new key, shown once:')}</b> <code style={{ userSelect: 'all' }}>{sp.created}</code><div className="small">{t('Copy it now; we keep only a fingerprint.')}</div></div>}
      <div className="split">
        <section className="card stack">
          <h2>{t('Your keys')}</h2>
          {!ok ? <PlanLock need="access" title={t('The read API')}>{t('Molecules, prices with history, registrations, tenders and imports for every market in your plan, as JSON, 120 calls a minute.')}</PlanLock> : (<>
            {keys.length === 0 ? <p className="note">{t('No key yet.')}</p> : <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>{t('Name')}</th><th>{t('Key')}</th><th className="hide-m">{t('Created')}</th><th className="hide-m">{t('Last used')}</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{keys.map((k) => <tr key={k.id} className={k.revoked_at ? 'muted' : undefined}><td>{k.name}</td><td className="num small">{k.prefix}…</td><td className="hide-m small">{fmtDate(k.created_at)}</td><td className="hide-m small">{k.last_used_at ? fmtDate(k.last_used_at) : t('never')}</td>
                <td className="r">{k.revoked_at ? <span className="pill">{t('Revoked')}</span> : <form action={revokeApiKey}><input type="hidden" name="id" value={k.id} /><button className="btn-link small" type="submit">{t('Revoke')}</button></form>}</td></tr>)}</tbody></table></div>}
            <form action={createApiKey} className="row" style={{ gap: 6 }}>
              <input className="input" name="name" placeholder={t('What this key is for')} aria-label={t('Key name')} maxLength={60} style={{ flex: '1 1 200px', minHeight: 34, fontSize: 13 }} />
              <button className="btn btn-blue btn-sm" type="submit">{t('Create a key')}</button>
            </form>
          </>)}
        </section>
        <section className="card stack small">
          <h2>{t('How to call it')}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: 'var(--soft)', padding: 10, borderRadius: 8 }}>{`curl -H "Authorization: Bearer nzx_…" \\\n  "${base}/api/v1/molecules?market=TZ&max=2&essential=1"`}</pre>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><code>/api/v1/markets</code> · {t('the markets in your plan and what we hold on each')}</li>
            <li><code>/api/v1/molecules?market=</code> · {t('every molecule: competition, demand, essential list, median price (filters as in Opportunities)')}</li>
            <li><code>/api/v1/prices?market=&molecule=</code> · {t('median shelf prices with sources and confidence; daily history for one molecule')}</li>
            <li><code>/api/v1/registrations?market=&molecule=</code> · {t('every registered product of a molecule, with holder')}</li>
            <li><code>/api/v1/tenders?market=</code> · {t('public medicine tenders (stage, since, molecule)')}</li>
            <li><code>/api/v1/imports?market=</code> · {t('medicine imports by year, HS line and origin')}</li>
            <li><code>/api/v1/products</code> · {t('your catalogue with its market facts')}</li>
          </ul>
          <p className="note">{t('Same data, same plan limits as the portal. 120 calls a minute per key. JSON only.')} <a href="/api/v1">{t('Index')}</a></p>
        </section>
      </div>
    </Shell>
  );
}
