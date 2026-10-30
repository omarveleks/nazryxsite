import Link from 'next/link';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { askQuestion } from '@/app/actions/collab';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { ago } from '@/lib/format';
import { askReady } from '@/lib/ask';

export const metadata = { title: 'Ask Nazryx' };

const EXAMPLES = [
  'Which of my products has the least competition in Tanzania, and what would it cost to register?',
  'Which distributors in Kenya already sell my class but not my molecules?',
  'Is there an open tender on any of my molecules this month?',
  'What does Kazakhstan require to register a tablet, and how long does it take?',
  'Where is amoxicillin cheapest across my markets, and how sure is the price?',
];

// Ask Nazryx: a question over your own data and the markets, every number pulled from the portal and every answer
// citing the page it came from. Runs on the Claude API; off when no key is set.
export default async function Ask({ searchParams }: { searchParams: Promise<{ a?: string; q?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => ({
    current: sp.a ? await one(db, 'select * from ask_log where id = $1 and user_id = $2', [Number(sp.a) || 0, u.id]) : null,
    recent: await rows(db, 'select id, question, created_at from ask_log where user_id = $1 order by id desc limit 12', [u.id]),
  }));
  const ready = askReady();
  // the answer's markdown is modest: paragraphs, bullets and [text](href) links to portal pages
  const render = (text: string) => text.split(/\n{2,}/).map((para, i) => {
    const lines = para.split('\n');
    const isList = lines.every((l) => /^\s*[-*•]\s/.test(l));
    const inline = (s: string) => s.split(/(\[[^\]]+\]\(\/[^)]+\))/g).map((part, j) => { const m = part.match(/^\[([^\]]+)\]\((\/[^)]+)\)$/); return m ? <Link key={j} href={m[2]}>{m[1]}</Link> : <span key={j}>{part.replace(/\*\*([^*]+)\*\*/g, '$1')}</span>; });
    return isList ? <ul key={i} style={{ margin: 0, paddingLeft: 18 }}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s/, ''))}</li>)}</ul> : <p key={i} style={{ margin: 0 }}>{lines.map((l, j) => <span key={j}>{inline(l)}{j < lines.length - 1 && <br />}</span>)}</p>;
  });
  return (
    <Shell user={u} help={t('Ask a question in plain words about a molecule, a market or a distributor. The answer comes from the data you see here, with links to the pages behind it.')} title={t('Ask Nazryx')} sub={t('A question over your own data and your markets. Every answer says where it came from.')}>
      <Flash sp={sp} />
      <div className="split">
        <div className="stack">
          <section className="card stack">
            <form action={askQuestion} className="stack" style={{ gap: 8 }}>
              <textarea className="input" name="q" rows={3} maxLength={2000} defaultValue={sp.q ?? ''} placeholder={t('e.g. Which of my products has the least competition in Uzbekistan, and what would it cost to register?')} aria-label={t('Your question')} required disabled={!ready} />
              <div className="between"><span className="note">{ready ? t('Answers come from the portal’s data through tools; nothing is made up. Numbers carry their confidence.') : t('Ask Nazryx is not switched on for this installation yet. Our team can answer the same questions on a call.')}</span>
                {ready ? <button className="btn btn-blue btn-sm" type="submit">{t('Ask')}</button> : <Link className="btn btn-ghost btn-sm" href="/m/call">{t('Book a call')}</Link>}</div>
            </form>
          </section>
          {d.current && (
            <section className="card stack">
              <div className="card-h"><h2>{d.current.question}</h2><span className="note">{d.current.ms ? `${(d.current.ms / 1000).toFixed(1)} s` : ''}{d.current.tools ? ` · ${d.current.tools} ${t('lookups')}` : ''}</span></div>
              <div className="stack" style={{ gap: 8 }}>{render(String(d.current.answer ?? ''))}</div>
              {Array.isArray(d.current.cites) && d.current.cites.length > 0 && !/Sources:/i.test(String(d.current.answer)) && (
                <div><span className="lbl">{t('Sources')}</span><div className="row" style={{ gap: 6, marginTop: 6 }}>{(d.current.cites as { title: string; href: string }[]).map((c) => <Link key={c.href} className="pill" href={c.href}>{c.title}</Link>)}</div></div>)}
            </section>)}
          {!d.current && (
            <section className="card stack">
              <h2>{t('Try one of these')}</h2>
              {EXAMPLES.map((q) => <form key={q} action={askQuestion}><input type="hidden" name="q" value={q} /><button type="submit" className="btn-link small" style={{ textAlign: 'left' }} disabled={!ready}>{t(q)}</button></form>)}
            </section>)}
        </div>
        <section className="card stack">
          <h2>{t('Your questions')}</h2>
          {d.recent.length === 0 ? <p className="note">{t('Nothing asked yet.')}</p> : d.recent.map((r) => <Link key={r.id} href={`/m/ask?a=${r.id}`} className="small" style={{ display: 'block' }}>{r.question.slice(0, 90)}<span className="sub2" style={{ display: 'block' }}>{ago(r.created_at)}</span></Link>)}
          <p className="note">{t('It can also explain a dossier gap, summarise a tender or write the narrative of a market read: ask it on the page in question.')}</p>
        </section>
      </div>
    </Shell>
  );
}
