import { Empty } from '@/components/ui';
import { rows, withUser } from '@/lib/db';
import { ago } from '@/lib/format';
import { MFR_COUNTRIES, countryName } from '@/lib/mfr';
import { REG_APPLIES, REG_DOC_STATUS, REG_TOPICS } from '@/lib/regulatory';
import { deleteRegDoc, deleteRequirement, publishDrafts, rereadRegDoc, saveRequirement, uploadRegDoc } from '@/app/actions/regulatory';

// Admin > Regulatory: upload regulatory documents for any country; the worker reads them into draft requirements;
// the team edits and publishes. Customers see published requirements on their Regulatory page, never the documents.
export default async function RegulatoryTab({ userId, country }: { userId: string; country?: string }) {
  const c = MFR_COUNTRIES.some((x) => x.code === country) ? country! : 'TZ';
  const d = await withUser(userId, async (db) => ({
    counts: await rows(db, `select country, count(*) filter (where status = 'published')::int as published, count(*) filter (where status = 'draft')::int as drafts
                            from reg_requirements group by country`),
    docs: await rows(db, `select d.id, d.title, d.file_name, d.status, d.error, d.found, d.created_at, u.email from reg_documents d
                          left join users u on u.id = d.uploaded_by where d.country = $1 order by d.created_at desc`, [c]),
    reqs: await rows(db, `select r.*, d.title as doc from reg_requirements r left join reg_documents d on d.id = r.document_id
                          where r.country = $1 order by (r.status = 'draft') desc, r.sort, r.id`, [c]),
  }));
  const count = (k: string) => d.counts.find((x) => x.country === k);
  const drafts = d.reqs.filter((r) => r.status === 'draft').length;

  const Fields = ({ r }: { r?: any }) => (<>
    <input type="hidden" name="country" value={c} />{r && <input type="hidden" name="id" value={r.id} />}
    <select className="input" name="topic" aria-label="Topic" defaultValue={r?.topic ?? 'Dossier'}>{REG_TOPICS.map((t) => <option key={t}>{t}</option>)}</select>
    <select className="input" name="applies" aria-label="Applies to" defaultValue={r?.applies ?? 'all'}>
      {Object.entries(REG_APPLIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    <input className="input" name="match" defaultValue={r?.match ?? ''} placeholder="Class, ATC (J01), form (tablet) or molecule" aria-label="Which one" />
    <input className="input" name="sort" type="number" defaultValue={r?.sort ?? 100} aria-label="Order" title="Order on the page" />
    <input className="input full" name="title" defaultValue={r?.title ?? ''} placeholder="Short title" aria-label="Title" required />
    <textarea className="input full" name="body" defaultValue={r?.body ?? ''} rows={2} placeholder="The requirement, in one or two plain sentences" aria-label="Requirement" required />
    <select className="input" name="status" aria-label="Status" defaultValue={r?.status ?? 'published'}>
      <option value="published">Published: customers see it</option><option value="draft">Draft: team only</option></select>
  </>);

  return (<>
    <p className="note">Upload regulatory documents for any country: guidelines, circulars, checklists. Each one is read automatically and its
      requirements come back as drafts below for you to check and publish. Customers see
      published requirements on their Regulatory page, overall and for each of their products. They never see the documents.</p>
    <div className="row" style={{ gap: 6 }}>{MFR_COUNTRIES.map((x) => {
      const n = count(x.code);
      return <a key={x.code} href={`/admin?tab=regulatory&rc=${x.code}`} className={`pill ${x.code === c ? 'solid' : ''}`}>
        {x.name}{n ? ` · ${n.published}${n.drafts ? ` + ${n.drafts} drafts` : ''}` : ''}</a>;
    })}</div>

    <div className="grid g2">
      <section className="card stack">
        <h2>Upload documents</h2>
        <form action={uploadRegDoc} className="form-grid">
          <select className="input" name="country" aria-label="Country" defaultValue={c}>{MFR_COUNTRIES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select>
          <input className="input" name="title" placeholder="Title (one file only)" aria-label="Title" />
          <input className="full" name="file" type="file" multiple required aria-label="Files" accept=".pdf,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg,.xls,.xlsx" />
          <button className="btn btn-blue btn-sm full" type="submit">Upload to {countryName(c)}</button>
        </form>
        <p className="note">PDF, Word, text and images are read automatically. Up to 20 files at once, 20 MB each.</p>
      </section>
      <section className="card stack">
        <h2>Add a requirement by hand</h2>
        <form action={saveRequirement} className="form-grid"><Fields />
          <button className="btn btn-ghost btn-sm" type="submit">Add to {countryName(c)}</button></form>
      </section>
    </div>

    <section className="card stack">
      <h2>{countryName(c)} documents ({d.docs.length})</h2>
      {d.docs.length === 0 ? <Empty>No documents for {countryName(c)} yet.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{d.docs.map((x) => {
          const [label, tone] = REG_DOC_STATUS[x.status] ?? [x.status, ''];
          return (
            <tr key={x.id}><td><a href={`/files/regdoc/${x.id}`}><b>{x.title}</b></a>
              <div className="sub2">{x.file_name} · {x.email ?? 'team'} · {ago(x.created_at)}{x.error ? ` · ${x.error}` : ''}</div></td>
              <td className="r"><span className={`pill ${tone}`}>{label}{x.status === 'done' ? `: ${x.found} found` : ''}</span></td>
              <td className="r" style={{ whiteSpace: 'nowrap' }}>
                {['done', 'failed', 'manual'].includes(x.status) && <form action={rereadRegDoc} style={{ display: 'inline' }}><input type="hidden" name="doc_id" value={x.id} />
                  <input type="hidden" name="country" value={c} /><button className="btn-link small" type="submit">Read again</button></form>}{' '}
                <form action={deleteRegDoc} style={{ display: 'inline' }}><input type="hidden" name="doc_id" value={x.id} /><input type="hidden" name="country" value={c} />
                  <button className="btn-link small" type="submit">Remove</button></form></td></tr>);
        })}</tbody></table></div>)}
    </section>

    <section className="card stack">
      <div className="card-h"><h2>{countryName(c)} requirements ({d.reqs.length})</h2>
        {drafts > 0 && <form action={publishDrafts}><input type="hidden" name="country" value={c} />
          <button className="btn btn-blue btn-sm" type="submit">Publish {drafts} drafts</button></form>}</div>
      {d.reqs.length === 0 ? <Empty>No requirements for {countryName(c)} yet. Upload a document or add one by hand.</Empty> : (
        <div className="stack" style={{ gap: 6 }}>{d.reqs.map((r) => (
          <details key={r.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            <summary className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <span className={`pill ${r.status === 'draft' ? 'peach' : 'mint'}`}>{r.status === 'draft' ? 'Draft' : 'Live'}</span>
              <span className="pill">{r.topic}</span>
              {r.applies !== 'all' && <span className="pill lav">{REG_APPLIES[r.applies]}: {r.match}</span>}
              <b className="small">{r.title}</b>{r.doc && <span className="sub2">from {r.doc}</span>}
            </summary>
            <form action={saveRequirement} className="form-grid" style={{ marginTop: 8 }}><Fields r={r} />
              <button className="btn btn-ghost btn-sm" type="submit">Save</button></form>
            <form action={deleteRequirement} style={{ marginTop: 4 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="country" value={c} />
              <button className="btn-link small" type="submit">Delete</button></form>
          </details>))}</div>)}
    </section>
  </>);
}
