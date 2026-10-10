import Link from 'next/link';
import type { ReactNode } from 'react';
import { GLOBAL_LIST, OFFICIAL_SHORT, STAGES, score as fmtScore } from '@/lib/format';

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

export function StatusPills({ official, global }: { official?: boolean; global?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      {official && <span className="pill blue">{OFFICIAL_SHORT}</span>}
      {global && <span className="pill mint">{GLOBAL_LIST}</span>}
      {!official && !global && <span className="pill">Not listed</span>}
    </span>
  );
}

export function Score({ value, size }: { value: number | string | null; size?: 'sm' }) {
  return <div className={`score ${size ?? ''}`}><b className="num">{fmtScore(value)}</b><span>/100</span></div>;
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
