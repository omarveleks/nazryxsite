import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Brand from '@/components/Brand';
import { one, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { countryName } from '@/lib/mfr';
import { PROJECT_STAGES, stageIndex, stageLabel } from '@/lib/projects';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shared project', robots: { index: false, follow: false } };

// A read-only view of a project for the person who signs: where it stands, the tasks and the dossier state. No session;
// the link is the key, and it expires.
export default async function SharedProject({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) notFound();
  const p = await withUser(null, (db) => one(db, 'select * from shared_project($1)', [token]));
  if (!p) notFound();
  const tasks = (p.tasks ?? []) as { title: string; done: boolean; due: string | null; stage: string | null }[];
  const checklist = (p.checklist ?? []) as { name: string; ready: boolean }[];
  const ready = checklist.filter((c) => c.ready).length, idx = stageIndex(p.stage);
  return (
    <div className="wrap-narrow" style={{ maxWidth: 820, padding: '24px 16px 48px' }}>
      <div className="between" style={{ marginBottom: 18 }}><Brand href="/" tag="Shared" /><span className="pill">Read-only</span></div>
      <h1 style={{ fontSize: 30, letterSpacing: '-0.02em', margin: '0 0 4px' }}>{p.name} · {countryName(p.country)}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{p.company ? `${p.company} · ` : ''}Market entry project · updated {fmtDate(p.updated_at)}</p>
      <section className="card stack">
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{PROJECT_STAGES.map(([k, label], i) => <span key={k} className={`pill ${k === p.stage ? 'solid' : i < idx ? 'mint' : ''}`}>{i < idx ? '✓ ' : ''}{label}</span>)}</div>
        <p className="small">Stage: <b>{stageLabel(p.stage)}</b>{p.target_date ? ` · on the shelf by ${fmtDate(p.target_date)}` : ''}</p>
        {p.note && <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{p.note}</p>}
      </section>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <section className="card stack">
          <h2>Tasks</h2>
          {tasks.length === 0 ? <p className="note">No tasks yet.</p> : tasks.map((k, i) => <div key={i} className="small" style={{ textDecoration: k.done ? 'line-through' : undefined, color: k.done ? 'var(--ink-3)' : undefined }}>{k.done ? '✓' : '○'} {k.title}{k.due ? <span className="sub2"> · due {fmtDate(k.due)}</span> : null}</div>)}
        </section>
        <section className="card stack">
          <div className="card-h"><h2>Dossier</h2><span className="note">{ready} of {checklist.length} ready</span></div>
          <div className="meter"><i style={{ width: `${checklist.length ? Math.round((100 * ready) / checklist.length) : 0}%` }} /></div>
          {checklist.filter((c) => !c.ready).slice(0, 12).map((c) => <div key={c.name} className="small">○ {c.name}</div>)}
          {checklist.filter((c) => !c.ready).length > 12 && <p className="note">and {checklist.filter((c) => !c.ready).length - 12} more missing</p>}
        </section>
      </div>
      <p className="note" style={{ marginTop: 16 }}>Shared from Nazryx Intelligence. This link shows the project as it stands now and expires after 30 days.</p>
    </div>
  );
}
