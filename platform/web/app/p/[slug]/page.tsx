import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Brand from '@/components/Brand';
import { VerifiedIcon } from '@/components/Icons';
import { one, withUser } from '@/lib/db';
import { countryName } from '@/lib/mfr';

export const dynamic = 'force-dynamic';

// A manufacturer's public page: what it makes, where it is registered, how far it is checked. Indexable, so distributors,
// buyers and regulators find it; nothing about plans, prices or people.
async function load(slug: string) {
  return withUser(null, (db) => one(db, 'select * from public_profile($1)', [slug.toLowerCase().slice(0, 80)]));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: 'Manufacturer', robots: { index: false } };
  return {
    title: `${p.company_name} · pharmaceutical manufacturer`,
    description: `${p.company_name}${p.hq_country ? `, ${countryName(p.hq_country) || p.hq_country}` : ''}: ${p.registrations} registrations in ${(p.markets ?? []).map((c: string) => countryName(c)).join(', ') || 'frontier markets'}. ${p.verified ? 'Verified by Nazryx.' : ''}`,
    robots: { index: true, follow: true },
  };
}

export default async function PublicProfile({ params }: { params: Promise<{ slug: string }> }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const classes = (p.classes ?? []) as { category: string; n: number }[];
  const max = Math.max(1, ...classes.map((c) => c.n));
  return (
    <main className="wrap-narrow" id="main" style={{ maxWidth: 860, padding: '24px 16px 48px' }}>
      <div className="between" style={{ marginBottom: 20 }}><Brand href="/p" tag="Manufacturers" /><Link className="btn btn-ghost btn-sm" href="/signup">For manufacturers</Link></div>
      <header className="stack" style={{ gap: 6, marginBottom: 18 }}>
        <div className="row" style={{ gap: 8 }}>
          {p.audited && <span className="pill mint"><VerifiedIcon /> Audited</span>}
          {p.verified && <span className="pill blue"><VerifiedIcon /> Verified manufacturer</span>}
          {!p.verified && <span className="pill">Listed</span>}
        </div>
        <h1 style={{ fontSize: 34, letterSpacing: '-0.02em', margin: 0 }}>{p.company_name}</h1>
        <p className="muted" style={{ margin: 0 }}>{[p.hq_country ? countryName(p.hq_country) || p.hq_country : null, p.website ? <a key="w" href={/^https?:/.test(p.website) ? p.website : `https://${p.website}`} rel="noopener noreferrer nofollow" target="_blank">{p.website.replace(/^https?:\/\//, '')}</a> : null].filter(Boolean).map((x, i) => <span key={i}>{i ? ' · ' : ''}{x}</span>)}</p>
      </header>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="tile t-blue"><span className="k">Registrations held</span><span className="v num">{p.registrations}</span><span className="small">in the registers we read</span></div>
        <div className="tile t-mint"><span className="k">Markets registered in</span><span className="v num">{(p.markets ?? []).length}</span><span className="small">{(p.markets ?? []).map((c: string) => countryName(c)).join(', ') || 'none in our markets yet'}</span></div>
        <div className="tile t-lav"><span className="k">Molecules in catalogue</span><span className="v num">{p.molecules}</span><span className="small">{classes.length} therapeutic classes</span></div>
      </div>
      <div className="grid g2">
        <section className="card stack">
          <h2>What it makes</h2>
          {classes.length === 0 ? <p className="muted">The catalogue is being added.</p> : classes.map((c) => (
            <div key={c.category} className="bar-row"><span>{c.category}</span><span className="bar" role="img" aria-label={`${c.n} molecules`}><i style={{ width: `${(100 * c.n) / max}%` }} /></span><span className="num small muted">{c.n}</span></div>))}
          {(p.dosage_forms ?? []).length > 0 && <div><span className="lbl">Dosage forms</span><div className="row" style={{ gap: 6, marginTop: 6 }}>{p.dosage_forms.map((f: string) => <span key={f} className="pill">{f}</span>)}</div></div>}
          {(p.therapeutic_areas ?? []).length > 0 && <div><span className="lbl">Therapeutic areas</span><div className="row" style={{ gap: 6, marginTop: 6 }}>{p.therapeutic_areas.map((f: string) => <span key={f} className="pill">{f}</span>)}</div></div>}
        </section>
        <div className="stack">
          <section className="card stack">
            <h2>Trust</h2>
            <p className="small"><b>{p.audited ? 'Audited' : p.verified ? 'Verified' : 'Listed'}.</b> {p.audited ? 'A site visit or a recognised inspection confirmed the company’s GMP status.' : p.verified ? 'Company documents and certificates were checked by Nazryx.' : 'The company has an account; its documents are not checked yet.'}</p>
            {(p.certifications ?? []).length > 0 && <div className="row" style={{ gap: 6 }}>{p.certifications.map((c: string) => <span key={c} className="pill blue">{c}</span>)}</div>}
            <p className="small muted">Registrations are counted from the national medicines registers Nazryx reads; the catalogue is as the manufacturer states it.</p>
          </section>
          <section className="card stack">
            <h2>Work with {p.company_name}</h2>
            <p className="small muted">Distributors and buyers: ask for an introduction and Nazryx makes it. Manufacturers: get your own page by signing up and verifying your company.</p>
            <div className="row"><Link className="btn btn-blue btn-sm" href={`/signup?as=distributor&about=${encodeURIComponent(p.company_name)}`}>Ask for an introduction</Link><Link className="btn btn-ghost btn-sm" href="/signup">Create your page</Link></div>
          </section>
        </div>
      </div>
      <p className="note" style={{ marginTop: 18 }}>Nazryx Intelligence · market data, registration and distributors for medicine exporters to frontier markets. <Link href="/p">All manufacturers</Link></p>
    </main>
  );
}
