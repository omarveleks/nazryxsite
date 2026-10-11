import { ENGAGEMENT_DOC_ITEMS } from '@/lib/docs';
import { postEngagementMessage, uploadEngagementFile } from '@/app/actions/mfr';
import { one, rows, type Db } from '@/lib/db';
import { Empty } from '@/components/ui';
import { DOSSIER_ITEMS, fmtDate } from '@/lib/format';
import { OBLIGATION_KINDS, SERVICES, countryName } from '@/lib/mfr';

const REVIEW: Record<string, [string, string]> = { submitted: ['Submitted', ''], accepted: ['Accepted', 'mint'], gap: ['Gap', 'peach'] };
const itemLabel = (k: string) => ENGAGEMENT_DOC_ITEMS.find(([x]) => x === k)?.[1] ?? k;

/** One engagement as both the client and the team see it. The team adds its controls around it. */
export function Milestones({ kind, stage, status }: { kind: string; stage: string; status: string }) {
  const steps = SERVICES[kind].milestones;
  const at = steps.indexOf(stage);
  if (status === 'cancelled') return <span className="pill">Cancelled</span>;
  return (
    <span className="row" style={{ gap: 6 }}>{steps.map((s, i) => (
      <span key={s} className={`pill ${status === 'done' || i < at ? 'mint' : i === at ? 'solid' : ''}`}>{s}</span>))}</span>
  );
}

export function EngagementBody({ e, files, messages, obligations, team }: {
  e: any; files: any[]; messages: any[]; obligations: any[]; team?: boolean;
}) {
  const client = files.filter((f) => !f.from_team);
  const ours = files.filter((f) => f.from_team);
  const docs = ['dossier_review', 'market_entry', 'eac_rollout', 'local_rep'].includes(e.kind);
  return (
    <div className="split">
      <div className="stack">
        <section className="card stack">
          <div className="card-h"><h2>Where we are</h2><span className="note">Updated {fmtDate(e.updated_at)}</span></div>
          <Milestones kind={e.kind} stage={e.stage} status={e.status} />
          <p className="muted">{SERVICES[e.kind].what}</p>
          <table className="tbl"><tbody>
            {e.country && <tr><td>Country</td><td>{countryName(e.country)}</td></tr>}
            {e.product && <tr><td>Product</td><td>{e.product}</td></tr>}
            {e.report_type && <tr><td>Report</td><td>{String(e.report_type).replaceAll('_', ' ')}</td></tr>}
            {e.kind === 'report' && e.due_at && <tr><td>Due</td><td>{new Date(e.due_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td></tr>}
            {e.detail && <tr><td>Your note</td><td style={{ whiteSpace: 'pre-wrap' }}>{e.detail}</td></tr>}
          </tbody></table>
        </section>

        {(ours.length > 0 || e.kind === 'report') && (
          <section className="card stack">
            <h2>{e.kind === 'report' ? 'Your report' : 'From Nazryx'}</h2>
            {ours.length === 0 ? <Empty>Your report appears here as soon as it is ready.</Empty>
              : ours.map((f) => <a key={f.id} href={`/files/engagement/${f.id}`}>{f.file_name}<span className="sub2"> · {itemLabel(f.item)} · {fmtDate(f.created_at)}</span></a>)}
          </section>)}

        {docs && (
          <section className="card stack">
            <div className="card-h"><h2>Dossier room</h2>{client.length > 0 && <span className="note">{client.filter((f) => f.review === 'accepted').length} of {client.length} accepted</span>}</div>
            <p className="note">Upload your documents here. Our team checks each one and marks it accepted, or a gap with a comment.</p>
            {client.length === 0 ? <Empty>No documents yet.</Empty> : (
              <table className="tbl"><tbody>{client.map((f) => (
                <tr key={f.id}><td><a href={`/files/engagement/${f.id}`}>{f.file_name}</a><div className="sub2">{itemLabel(f.item)} · {fmtDate(f.created_at)}</div>
                  {f.team_comment && <div className="small" style={{ marginTop: 4 }}><b>Nazryx:</b> {f.team_comment}</div>}</td>
                  <td className="r"><span className={`pill ${REVIEW[f.review][1]}`}>{REVIEW[f.review][0]}</span></td></tr>))}</tbody></table>)}
            {!team && (
              <form action={uploadEngagementFile} className="row">
                <input type="hidden" name="engagement_id" value={e.id} />
                <select className="input" name="item" aria-label="What the document is" defaultValue="" required style={{ flex: '1 1 220px' }}>
                  <option value="" disabled>What is it?</option>
                  {DOSSIER_ITEMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="other">Other document</option></select>
                <input name="file" type="file" required aria-label="Document" style={{ flex: '1 1 200px' }} />
                <button className="btn btn-blue btn-sm" type="submit">Upload</button>
              </form>)}
          </section>)}

        {e.kind === 'post_registration' && (
          <section className="card stack">
            <h2>Deadlines we track for you</h2>
            {obligations.length === 0 ? <Empty>We add each renewal, variation and safety report as we onboard your registrations.</Empty> : (
              <table className="tbl"><tbody>{obligations.map((o) => (
                <tr key={o.id}><td>{OBLIGATION_KINDS[o.kind]}{o.product ? ` · ${o.product}` : ''}<div className="sub2">{countryName(o.country)}{o.note ? ` · ${o.note}` : ''}</div></td>
                  <td className="r"><span className={`pill ${o.done ? 'mint' : ''}`}>{o.done ? 'Done' : fmtDate(o.due_date)}</span></td></tr>))}</tbody></table>)}
          </section>)}
      </div>

      <section className="card stack">
        <h2>Messages</h2>
        {messages.length === 0 && <Empty>{team ? 'No messages yet.' : 'Our team writes here as the work moves. Ask anything.'}</Empty>}
        {messages.map((m) => <div key={m.id} className={`msg ${(team ? !m.from_team : m.from_team) ? 'team' : 'me'}`}>
          <b>{m.from_team ? 'Nazryx' : team ? 'Client' : 'You'}:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span><div className="tiny muted">{fmtDate(m.created_at)}</div></div>)}
        <form action={postEngagementMessage} className="stack" style={{ gap: 8 }}>
          <input type="hidden" name="engagement_id" value={e.id} />
          <textarea className="input" name="body" aria-label="Message" placeholder="Write a message" required rows={3} />
          <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Send</button>
        </form>
      </section>
    </div>
  );
}

/** Data for one engagement, through the caller's own permissions. */
export async function loadEngagement(db: Db, id: number) {
  const e = await one(db, `select e.*, coalesce(m.inn, p.name) as product, u.email, mp.company_name
                           from engagements e join users u on u.id = e.user_id left join mfr_products p on p.id = e.product_id
                           left join molecules m on m.id = p.molecule_id left join manufacturer_profiles mp on mp.user_id = e.user_id where e.id = $1`, [id]);
  if (!e) return null;
  return {
    e,
    files: await rows(db, 'select id, item, file_name, from_team, internal, review, team_comment, created_at from engagement_files where engagement_id = $1 order by created_at', [id]),
    messages: await rows(db, 'select id, from_team, body, created_at from engagement_messages where engagement_id = $1 order by created_at', [id]),
    obligations: e.kind === 'post_registration' ? await rows(db, `select o.*, coalesce(m.inn, p.name) as product from obligations o
        left join mfr_products p on p.id = o.product_id left join molecules m on m.id = p.molecule_id where o.user_id = $1 order by o.done, o.due_date`, [e.user_id]) : [],
  };
}
