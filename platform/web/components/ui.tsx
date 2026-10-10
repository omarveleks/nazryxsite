import Link from 'next/link';
import type { ReactNode } from 'react';
import { GLOBAL_LIST, LEVEL_SHORT, OFFICIAL_SHORT, STAGES } from '@/lib/format';

export function Locked({ title, children, cta = 'Upgrade' }: { title: string; children?: ReactNode; cta?: string }) {
  return (
    <div className="locked">
      <span className="pill lav">Paid</span>
      <b>{title}</b>
      {children && <span className="note">{children}</span>}
      <Link className="btn btn-ghost btn-sm" href="/settings#plan">{cta}</Link>
    </div>
  );
}

export type BadgeFacts = {
  on_national_list?: boolean | null; on_who_eml?: boolean | null; facility_level?: string | null;
  registrants?: number | null; registrations?: number | null; in_combinations?: number | null;
  channel_flag?: string | null; local_made?: number | null;
  in_portfolio?: boolean | null; watched?: boolean | null; request_stage?: string | null; supply?: boolean | null;
};

/** Every fact about a molecule worth a glance, as pills. `full` adds facility level and local manufacturing. */
export function Badges({ m, full }: { m: BadgeFacts; full?: boolean }) {
  const regs = Number(m.registrants ?? 0);
  const comboOnly = Number(m.registrations ?? 0) === 0 && Number(m.in_combinations ?? 0) > 0;
  return (
    <span className="row" style={{ gap: 6 }}>
      {m.in_portfolio && <span className="pill solid">In your portfolio</span>}
      {m.request_stage && <span className="pill solid">Requested · {m.request_stage}</span>}
      {m.on_national_list && <span className="pill blue">{OFFICIAL_SHORT}</span>}
      {m.on_who_eml && <span className="pill mint">{GLOBAL_LIST}</span>}
      {!m.on_national_list && !m.on_who_eml && <span className="pill">Not listed</span>}
      {full && m.on_national_list && m.facility_level && LEVEL_SHORT[m.facility_level] && <span className="pill">{LEVEL_SHORT[m.facility_level]}</span>}
      {comboOnly ? <span className="pill peach">Only in combinations</span>
        : regs === 0 ? <span className="pill peach">Nobody registered</span>
        : regs <= 3 ? <span className="pill peach">Few competitors</span>
        : regs >= 8 ? <span className="pill">Crowded</span> : null}
      {m.channel_flag === 'programme' && <span className="pill lav">Programme channel</span>}
      {full && Number(m.local_made ?? 0) > 0 && <span className="pill">Made locally</span>}
      {m.supply && <span className="pill mint">Supply confirmed</span>}
      {m.watched && <span className="pill">Watching</span>}
    </span>
  );
}

/** The one action on a molecule: ask Nazryx to source it. We evaluate it inside the request. */
export function SourceLink({ id, stage }: { id: number; stage?: string | null }) {
  if (stage) return <Link className="btn btn-ghost btn-sm" href="/requests">Open request</Link>;
  return <Link className="btn btn-blue btn-sm" href={`/requests/new?molecule=${id}`}>Source</Link>;
}

export function StagePill({ stage }: { stage: string }) {
  const cls = stage === 'Quote ready' ? 'solid' : stage === 'Closed' ? '' : stage === 'Submitted' ? 'peach' : 'blue';
  return <span className={`pill ${cls}`}>{stage}</span>;
}

export function Stages({ current }: { current: string }) {
  const i = STAGES.indexOf(current as (typeof STAGES)[number]);
  return (
    <div className="stages" aria-label={`Stage: ${current}`}>
      {STAGES.map((s, j) => <div key={s} className={`stage ${j < i ? 'done' : j === i ? 'now' : ''}`}>{s}</div>)}
    </div>
  );
}

export function Bar({ label, value, max, right, second }: { label: ReactNode; value: number; max: number; right?: ReactNode; second?: number }) {
  const w = (v: number) => `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%`;
  return (
    <div className="bar-row">
      <span>{label}</span>
      {second === undefined ? (
        <span className="bar" role="img" aria-label={`${value} of ${max}`} title={`${value} of ${max}`}><i style={{ width: w(value) }} /></span>
      ) : (
        <span className="bar2">
          <span className="bar" role="img" aria-label={`You: ${value}`} title={`You: ${value}`}><i style={{ width: w(value) }} /></span>
          <span className="bar" role="img" aria-label={`Them: ${second}`} title={`Them: ${second}`}><i className="them" style={{ width: w(second) }} /></span>
        </span>
      )}
      <span className="num small muted">{right}</span>
    </div>
  );
}

export function Tabs({ items, current }: { items: { key: string; label: string; href: string; locked?: boolean }[]; current: string }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={`${t.key === current ? 'on' : ''} ${t.locked ? 'lock' : ''}`}
          aria-selected={t.key === current} role="tab">{t.label}{t.locked ? ' · Paid' : ''}</Link>
      ))}
    </div>
  );
}

export function Flash({ sp }: { sp: { error?: string; saved?: string } }) {
  if (sp.error) return <div className="err" role="alert">{sp.error}</div>;
  if (sp.saved) return <div className="ok" role="status">Saved.</div>;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="note" style={{ padding: '10px 0' }}>{children}</div>;
}
