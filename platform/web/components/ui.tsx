import Link from 'next/link';
import type { ReactNode } from 'react';
import { GLOBAL_LIST, LEVELS, OFFICIAL_SHORT, PIPELINE, STAGE_INFO } from '@/lib/format';
import { toggleList } from '@/app/actions/app';
import { TIER, countryName, covers } from '@/lib/mfr';
import { CONFIDENCE, type Confidence } from '@/lib/prices';

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

export { LockIcon } from './Icons';
import { LockIcon } from './Icons';

/** A feature the manufacturer's plan does not include: what it is, which plan unlocks it, and the way there. When the plan
 *  has the feature but not this market (pass the user and the market), the way there is adding the market instead. */
export function PlanLock({ need, title, children, compact, u, market }: { need: 'data' | 'access' | 'entry'; title: string; children?: ReactNode;
  compact?: boolean; u?: { role: string; mfr_active: string | null; mfr_tier: number; mfr_markets?: string[] }; market?: string | null }) {
  const name = { data: 'Basic Market Data', access: 'Complete Market Access', entry: 'Complete Market Entry' }[need];
  if (u && market && u.mfr_active && !covers(u, market) && u.mfr_tier >= TIER[need]) {
    const href = `/m/add-market?market=${market}`;
    if (compact) return <Link className="pill lav" href={href} title={`${countryName(market)} is not in your plan yet`}><LockIcon /> {title}</Link>;
    return (
      <div className="locked">
        <span className="pill lav"><LockIcon /> Not in your plan yet</span>
        <b>{title}</b>
        {children && <span className="note">{children}</span>}
        <Link className="btn btn-blue btn-sm" href={href}>Add {countryName(market)} to your plan</Link>
      </div>
    );
  }
  if (compact) return <Link className="pill lav" href={`/m/plan?want=${need}`} title={`Included in ${name}. Click to see how to unlock it.`}><LockIcon /> {title}</Link>;
  return (
    <div className="locked">
      <span className="pill lav"><LockIcon /> {name}</span>
      <b>{title}</b>
      {children && <span className="note">{children}</span>}
      <Link className="btn btn-blue btn-sm" href={`/m/plan?want=${need}`}>Unlock with {name}</Link>
    </div>
  );
}

export type BadgeFacts = {
  on_national_list?: boolean | null; on_who_eml?: boolean | null; facility_level?: string | null;
  registrants?: number | null; registrations?: number | null; in_combinations?: number | null;
  channel_flag?: string | null; local_made?: number | null;
  in_portfolio?: boolean | null; watched?: boolean | null; request_stage?: string | null; supply?: boolean | null; in_list?: boolean | null;
};

/** Every fact about a molecule worth a glance, as pills: lists with their publisher and the local EML level,
 *  registration state, channel, and the customer's own status. Nothing that talks a customer out of a molecule. */
export function Badges({ m, full }: { m: BadgeFacts; full?: boolean }) {
  const regs = Number(m.registrants ?? 0);
  const comboOnly = Number(m.registrations ?? 0) === 0 && Number(m.in_combinations ?? 0) > 0;
  return (
    <span className="row" style={{ gap: 6 }}>
      {m.in_portfolio && <span className="pill solid">In your portfolio</span>}
      {m.request_stage && <span className="pill solid">{m.request_stage}</span>}
      {m.in_list && <span className="pill solid">In your sourcing list</span>}
      {m.on_national_list && <span className="pill blue">{OFFICIAL_SHORT}</span>}
      {m.on_national_list && m.facility_level && LEVELS[m.facility_level] &&
        <span className="pill blue" title={`EML level ${m.facility_level}: ${LEVELS[m.facility_level]}`}>EML level {m.facility_level}</span>}
      {m.on_who_eml && <span className="pill mint">{GLOBAL_LIST}</span>}
      {comboOnly ? <span className="pill peach">Only in combinations</span>
        : regs === 0 ? <span className="pill peach">Nobody registered</span>
        : regs <= 3 ? <span className="pill peach">Few competitors</span> : null}
      {m.channel_flag === 'programme' && <span className="pill lav">Programme channel</span>}
      {full && Number(m.local_made ?? 0) > 0 && <span className="pill">Made by a local factory</span>}
      {m.supply && <span className="pill mint">Supply confirmed</span>}
      {m.watched && <span className="pill">Watching</span>}
    </span>
  );
}

/** The two actions on a molecule: collect it in the sourcing list, or request it now. */
export function SourceLink({ id, stage, inList, back = '/search' }: { id: number; stage?: string | null; inList?: boolean | null; back?: string }) {
  if (stage) return <Link className="btn btn-ghost btn-sm" href="/requests">Open request</Link>;
  return (
    <>
      <form action={toggleList}><input type="hidden" name="molecule_id" value={id} /><input type="hidden" name="return" value={back} />
        <button className="btn btn-ghost btn-sm" type="submit">{inList ? 'In list ✓' : '+ List'}</button></form>
      <Link className="btn btn-blue btn-sm" href={`/requests/new?molecule=${id}`}>Source</Link>
    </>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const cls = stage === 'Pricing and logistics' ? 'solid' : stage === 'Closed' ? '' : stage === 'Product request' ? 'peach'
    : stage === 'Registration' || stage === 'Shipment' ? 'mint' : 'blue';
  return <span className={`pill ${cls}`}>{stage}</span>;
}

export function Stages({ current }: { current: string }) {
  const i = PIPELINE.indexOf(current as (typeof PIPELINE)[number]);
  return (
    <div className="stages" aria-label={`Stage: ${current}`}>
      {PIPELINE.map((s, j) => <div key={s} title={STAGE_INFO[s]} className={`stage ${j < i ? 'done' : j === i ? 'now' : ''}`}>{s}</div>)}
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

/** How sure a price is, as a chip: Measured, Thin or Estimated, with the meaning on hover. */
export function ConfidenceChip({ level }: { level?: Confidence | null }) {
  const c = CONFIDENCE[level ?? 'estimated'];
  return <span className={`pill ${c.tone}`} title={c.title}>{c.label}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="note" style={{ padding: '10px 0' }}>{children}</div>;
}
