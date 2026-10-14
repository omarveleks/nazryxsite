import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badges, type BadgeFacts } from '@/components/ui';
import { registeredLine } from '@/lib/format';

type Row = BadgeFacts & { id: number; inn: string; category?: string | null; forms?: string | null };

/** One molecule in a list: name, class and registrations, badges, then the actions (they wrap below on a phone). */
export function MoleculeRow({ m, actions, extra, n, first }: { m: Row; actions: ReactNode; extra?: ReactNode; n?: number; first?: boolean }) {
  return (
    <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '14px 0', borderTop: first ? undefined : '1px solid var(--line)' }}>
      <div style={{ minWidth: 0, flex: '1 1 300px' }}>
        <div className="row" style={{ gap: 8 }}>
          {n !== undefined && <span className="num muted small">{n}</span>}
          <Link href={`/molecule/${m.id}`}><span className="nm">{m.inn}</span></Link>
        </div>
        <div className="sub2">{[m.category, Number(m.registrants ?? 0) > 0 ? registeredLine(m.registrants, m.registrations) : null].filter(Boolean).join(' · ')}</div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}><Badges m={m} />{extra}</div>
      </div>
      <div className="row" style={{ gap: 6 }}>{actions}</div>
    </div>
  );
}
