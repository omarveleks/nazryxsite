import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Empty, Flash, PlanLock } from '@/components/ui';
import { toggleChecklist } from '@/app/actions/mfr';
import { deleteDossierFile, prefillFromCtd, requestDossierReview, setDossierMeta, uploadDossierFile } from '@/app/actions/dossier';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { NEEDS_PLAN, canUse, countryName, productClass, tierIn } from '@/lib/mfr';
import { appliesTo, type Requirement } from '@/lib/regulatory';

export const metadata = { title: 'Dossier' };

// The dossier builder: the market's checklist as it applies to this product, with a tick, an upload, an owner and a
// due date per item, the readiness, the list of what is missing, a CTD paste that pre-fills it, and our review as a button.
export default async function DossierBuilder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ market?: string; saved?: string; error?: string; ticked?: string; item?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const acct = u.owner_id ?? u.id;
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [acct]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const p = await one(db, `select p.*, m.inn, m.category from mfr_products p left join molecules m on m.id = p.molecule_id where p.id = $1`, [id]);
    if (!p) return null;
    const tier = tierIn(u, market), open = canUse(tier, 'requirements');
    const items = open && hasData(market) ? (await rows(db, `select id, name, applies, match, note, source from reg_checklist where country = $1 and scope = 'medicine' order by sort`, [market]))
      .filter((c) => c.applies === 'all' || appliesTo({ ...c, topic: '', title: c.name, body: '' } as Requirement, { ...p, category: productClass(p) })) : [];
    const ready = new Set((await rows(db, 'select item from product_checklist where product_id = $1 and country = $2', [id, market])).map((r) => r.item as string));
    const files = await rows(db, 'select f.*, x.name as by from dossier_files f left join users x on x.id = f.uploaded_by where f.product_id = $1 and f.country = $2 order by f.created_at desc', [id, market]);
    const meta = await rows(db, 'select m.*, a.name as assignee from dossier_meta m left join users a on a.id = m.assignee_id where m.product_id = $1 and m.country = $2', [id, market]);
    const seats = await rows(db, 'select id, name, email from users where id = $1 or owner_id = $1 order by created_at', [acct]);
    const review = await one(db, `select id, stage from engagements where user_id = $1 and kind = 'dossier_review' and product_id = $2 and country = $3 and status = 'open'`, [acct, id, market]);
    const project = await one(db, 'select id from projects where product_id = $1 and country = $2', [id, market]);
    return { targets, market, p, open, items, ready, files, meta, seats, review, project };
  });
  if (!d) notFound();
  const { p, market } = d, name = t(countryName(market)), here = `/m/products/${id}/dossier?market=${market}`;
  const done = d.items.filter((c) => d.ready.has(c.name)).length, pct = d.items.length ? Math.round((100 * done) / d.items.length) : 0;
  const missing = d.items.filter((c) => !d.ready.has(c.name));
  const metaOf = (item: string) => d.meta.find((m) => m.item === item);
  const filesOf = (item: string) => d.files.filter((f) => f.item === item);
  return (
    <Shell user={u} title={t('Dossier: {product}', { product: p.inn ?? p.name })} sub={t('{market} · {n} of {total} documents ready', { market: name, n: done, total: d.items.length })}
      crumb={<><Link href={`/m/products/${id}?market=${market}`}>{p.inn ?? p.name}</Link> / {t('Dossier')}</>}
      actions={<>{d.project && <Link className="btn btn-ghost btn-sm" href={`/m/projects/${d.project.id}`}>{t('Project')}</Link>}
        {d.review ? <Link className="btn btn-ghost btn-sm" href={`/m/engagements/${d.review.id}`}>{t('Review in progress')}</Link>
          : <form action={requestDossierReview}><input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} />
              <button className="btn btn-blue btn-sm" type="submit">{t('Ask Nazryx to review')}</button></form>}</>}>
      <Flash sp={sp} />
      {sp.ticked && <div className="ok" role="status">{t('{n} items ticked from your module list.', { n: sp.ticked })}</div>}
      <MarketPicker u={u} targets={d.targets} current={market} path={`/m/products/${id}/dossier`} />
      {!hasData(market) ? <AgencyMarket code={market} /> : !d.open ? (
        <PlanLock need="access" title={t('The dossier checklist for {market}', { market: name })} u={u} market={market}>{t('Every document the regulator asks for, as it applies to this product, with uploads, owners and due dates, and our review as a button.')}</PlanLock>
      ) : d.items.length === 0 ? <section className="card"><Empty>{t('Our regulatory team is writing up the checklist for {market}.', { market: name })}</Empty></section> : (<>
        <div className="grid g3">
          <div className="tile t-blue"><span className="k">{t('Readiness')}</span><span className="v num">{pct}%</span><span className="small">{t('{n} of {total} documents', { n: done, total: d.items.length })}</span></div>
          <div className={`tile ${missing.length ? 't-peach' : 't-mint'}`}><span className="k">{t('Still missing')}</span><span className="v num">{missing.length}</span><span className="small">{missing.slice(0, 2).map((c) => c.name).join(' · ')}{missing.length > 2 ? ' …' : ''}</span></div>
          <div className="tile t-lav"><span className="k">{t('Uploaded')}</span><span className="v num">{d.files.length}</span><span className="small">{t('files on this dossier')}</span></div>
        </div>
        <div className="split">
          <section className="card stack">
            <div className="card-h"><div><h2>{t('Checklist for {market}', { market: name })}</h2><p className="note">{t('Tick what you have, upload it against the line, give it an owner and a date. Items that depend on the product (bioequivalence, biowaiver) show only when they apply.')}</p></div></div>
            <div className="meter"><i style={{ width: `${pct}%` }} /></div>
            <div className="stack" style={{ gap: 0 }}>{d.items.map((c, i) => { const ok = d.ready.has(c.name); const m = metaOf(c.name); const fs = filesOf(c.name); const openItem = sp.item === String(c.id); return (
              <div key={c.id} className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap', borderTop: i ? '1px solid var(--line)' : undefined, padding: '8px 0' }}>
                <form action={toggleChecklist} style={{ display: 'contents' }}>
                  <input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} /><input type="hidden" name="item" value={c.name} /><input type="hidden" name="return" value={here} />
                  <button type="submit" className={`check${ok ? ' on' : ''}`} aria-label={ok ? t('Mark as missing') : t('Mark as ready')} aria-pressed={ok}>{ok ? '✓' : ''}</button>
                </form>
                <details open={openItem} style={{ flex: 1, minWidth: 0 }}>
                <summary className="between" style={{ cursor: 'pointer', gap: 10, listStyle: 'none' }}>
                  <span className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap', minWidth: 0 }}>
                    <span style={{ minWidth: 0 }}><span style={{ color: ok ? 'var(--ink-3)' : undefined }}>{c.name}</span>
                      <span className="sub2" style={{ display: 'block' }}>{[c.note, m?.assignee ? `${t('owner')}: ${m.assignee}` : null, m?.due_date ? `${t('due')} ${fmtDate(m.due_date)}` : null, fs.length ? `${fs.length} ${fs.length === 1 ? t('file') : t('files')}` : null].filter(Boolean).join(' · ')}</span></span>
                  </span>
                  <span className={`pill ${ok ? 'mint' : 'peach'}`} style={{ fontSize: 11, flexShrink: 0 }}>{ok ? t('Ready') : t('Missing')}</span>
                </summary>
                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  {fs.map((f) => <div key={f.id} className="between small"><a href={`/files/dossier/${f.id}`}>{f.file_name}</a><span className="row" style={{ gap: 8 }}><span className="sub2">{f.by ?? ''} · {fmtDate(f.created_at)}</span>
                    <form action={deleteDossierFile}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} /><button className="btn-link x" type="submit" aria-label={t('Remove file')}>×</button></form></span></div>)}
                  <form action={uploadDossierFile} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} /><input type="hidden" name="item" value={c.name} />
                    <input className="input" type="file" name="file" aria-label={t('File for {item}', { item: c.name })} style={{ flex: '1 1 200px', minHeight: 34, fontSize: 13 }} required />
                    <button className="btn btn-ghost btn-sm" type="submit">{t('Upload')}</button>
                  </form>
                  <form action={setDossierMeta} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} /><input type="hidden" name="item" value={c.name} />
                    {d.seats.length > 1 && <select className="input" name="assignee_id" defaultValue={m?.assignee_id ?? ''} aria-label={t('Owner')} style={{ flex: '1 1 140px', minHeight: 34, fontSize: 13 }}><option value="">{t('Owner')}</option>{d.seats.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}</select>}
                    <input className="input" name="due_date" type="date" defaultValue={m?.due_date ? String(m.due_date).slice(0, 10) : ''} aria-label={t('Due date')} style={{ flex: '1 1 140px', minHeight: 34, fontSize: 13 }} />
                    <input className="input" name="note" defaultValue={m?.note ?? ''} placeholder={t('Note')} aria-label={t('Note')} maxLength={300} style={{ flex: '2 1 160px', minHeight: 34, fontSize: 13 }} />
                    <button className="btn btn-ghost btn-sm" type="submit">{t('Save')}</button>
                  </form>
                </div>
              </details>
              </div>); })}</div>
          </section>
          <div className="stack">
            <section className="card stack">
              <h2>{t('What is missing')}</h2>
              {missing.length === 0 ? <p className="small">{t('Nothing. Ask us to review the documents before you file.')}</p> : <ol className="small doc-links" style={{ margin: 0, paddingLeft: 18 }}>{missing.map((c) => <li key={c.id}><Link href={`${here}&item=${c.id}`}>{c.name}</Link></li>)}</ol>}
            </section>
            <section className="card stack">
              <h2>{t('Pre-fill from your CTD')}</h2>
              <p className="note">{t('Paste the module list or table of contents of a dossier you already have. Lines that name a document on the checklist tick it; you still upload the files.')}</p>
              <form action={prefillFromCtd} className="stack" style={{ gap: 6 }}>
                <input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} />
                <textarea className="input" name="text" rows={6} placeholder={'1.0 Cover letter\n1.2 Application form\n2.3 QOS\n3.2.S Drug substance\n3.2.P Drug product\n5.3.1 BE study report'} aria-label={t('CTD module list')} required />
                <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>{t('Tick what matches')}</button>
              </form>
            </section>
            <section className="card stack">
              <h2>{t('Our review')}</h2>
              <p className="small muted">{t('We read every document against the regulator’s requirements, confirm the route and list each gap before you file.')}</p>
              {d.review ? <Link className="btn btn-ghost btn-sm" href={`/m/engagements/${d.review.id}`} style={{ alignSelf: 'flex-start' }}>{t('Open the review')}</Link>
                : canUse(u.mfr_tier, 'dossier_review') ? <form action={requestDossierReview}><input type="hidden" name="product_id" value={id} /><input type="hidden" name="country" value={market} /><button className="btn btn-blue btn-sm" type="submit">{t('Ask Nazryx to review')}</button></form>
                : <PlanLock compact need={NEEDS_PLAN.dossier_review} title={t('Dossier review')} />}
            </section>
          </div>
        </div>
      </>)}
    </Shell>
  );
}
