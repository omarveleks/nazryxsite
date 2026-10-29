import type { Metadata } from 'next';
import Link from 'next/link';
import Brand from '@/components/Brand';
import { VerifiedIcon } from '@/components/Icons';
import { rows, withUser } from '@/lib/db';
import { countryName } from '@/lib/mfr';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verified pharmaceutical manufacturers', description: 'Manufacturers on Nazryx: what they make, where they are registered, how far they are checked.', robots: { index: true, follow: true } };

// The public directory of manufacturers who chose a public page. Audited first, then verified, then listed.
export default async function Directory({ searchParams }: { searchParams: Promise<{ q?: string; market?: string }> }) {
  const sp = await searchParams;
  const list = await withUser(null, (db) => rows(db, 'select * from public_profiles()'));
  const q = (sp.q ?? '').toLowerCase().slice(0, 60);
  const shown = list.filter((p) => (!q || String(p.company_name).toLowerCase().includes(q) || (p.forms ?? []).some((f: string) => f.toLowerCase().includes(q))) && (!sp.market || (p.markets ?? []).includes(sp.market)));
  const markets = [...new Set(list.flatMap((p) => p.markets ?? []))].sort() as string[];
  return (
    <div className="wrap-narrow" style={{ maxWidth: 960, padding: '24px 16px 48px' }}>
      <div className="between" style={{ marginBottom: 20 }}><Brand href="/p" tag="Manufacturers" /><Link className="btn btn-ghost btn-sm" href="/signup">For manufacturers</Link></div>
      <h1 style={{ fontSize: 32, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Manufacturers on Nazryx</h1>
      <p className="muted" style={{ marginTop: 0 }}>What each one makes, where it is registered, and how far Nazryx has checked it. Audited and verified companies first.</p>
      <form method="get" className="row" style={{ margin: '14px 0' }}>
        <input className="input" name="q" defaultValue={sp.q ?? ''} placeholder="Company or dosage form" aria-label="Search" style={{ flex: '2 1 220px' }} />
        <select className="input" name="market" defaultValue={sp.market ?? ''} aria-label="Registered in" style={{ flex: '1 1 160px' }}><option value="">Registered anywhere</option>{markets.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select>
        <button className="btn btn-blue btn-sm" type="submit">Search</button>
      </form>
      {shown.length === 0 ? <div className="card"><p className="muted">No public manufacturer page matches yet.</p></div> : (
        <div className="grid g2">{shown.map((p) => (
          <Link key={p.slug} href={`/p/${p.slug}`} className="card stack" style={{ textDecoration: 'none', color: 'inherit', gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>{p.audited ? <span className="pill mint"><VerifiedIcon /> Audited</span> : p.verified ? <span className="pill blue"><VerifiedIcon /> Verified</span> : <span className="pill">Listed</span>}</div>
            <b style={{ fontSize: 17 }}>{p.company_name}</b>
            <span className="small muted">{[p.hq_country ? countryName(p.hq_country) || p.hq_country : null, p.registrations ? `${p.registrations} registrations` : null, (p.markets ?? []).length ? (p.markets as string[]).map((c) => countryName(c)).join(', ') : null].filter(Boolean).join(' · ')}</span>
            {(p.forms ?? []).length > 0 && <span className="small">{(p.forms as string[]).slice(0, 5).join(' · ')}</span>}
          </Link>))}</div>)}
      <p className="note" style={{ marginTop: 18 }}>A manufacturer appears here once its company is approved and it turns its public page on in Settings.</p>
    </div>
  );
}
