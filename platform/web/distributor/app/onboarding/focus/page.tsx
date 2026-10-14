import Link from 'next/link';
import Brand from '@/components/Brand';
import { saveFocus } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { FOCUS_GOALS, LEVEL_FILTERS, SUPPLIER_COUNTRIES } from '@/lib/format';
import { categories } from '@/lib/queries';

export const metadata = { title: 'Set your focus' };

// Last onboarding step, and editable later from Settings. It shapes Home: picks, order of sections, suggestions.
export default async function Focus({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/home';
  const fromSettings = next.startsWith('/settings');
  const d = await withUser(u.id, async (db) => ({
    cats: await categories(db),
    f: await one(db, 'select classes, goals, supplier_countries, levels from user_focus where user_id = $1', [u.id]),
  }));
  const has = (k: 'classes' | 'goals' | 'supplier_countries' | 'levels', v: string) => Boolean(d.f?.[k]?.includes(v));
  return (
    <div className="wrap-narrow">
      <Brand href="/home" />
      <div>
        {!fromSettings && <div className="crumb">Step 3 of 3: your focus</div>}
        <h1>Set your focus</h1>
        <p className="muted" style={{ marginTop: 8 }}>Tell us what you are after. We use it to pick molecules, order your home page and brief our team. Change it any time in Settings.</p>
      </div>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}
      <form action={saveFocus} className="stack">
        <input type="hidden" name="next" value={next} />
        <section className="card stack">
          <h2>1. What is your company focused on right now?</h2>
          <div className="grid g2">{FOCUS_GOALS.map(([v, l, why]) => (
            <label key={v} className="choice"><input type="checkbox" name="goals" value={v} defaultChecked={has('goals', v)} />
              <span><b>{l}</b><br /><span className="note">{why}</span></span></label>))}</div>
        </section>
        <section className="card stack">
          <h2>2. Which therapeutic classes?</h2>
          <p className="note">Pick the classes you sell in or want to enter. Leave empty for all.</p>
          <div className="grid g2">{d.cats.map((c) => (
            <label key={c} className="choice"><input type="checkbox" name="classes" value={c} defaultChecked={has('classes', c)} /><span>{c}</span></label>))}</div>
        </section>
        <section className="card stack">
          <h2>3. Which levels of care do you sell into?</h2>
          <p className="note">The EML level on the official TMDA list: where a medicine may be stocked.</p>
          <div className="grid g2">{LEVEL_FILTERS.map(([v, l]) => (
            <label key={v} className="choice"><input type="checkbox" name="levels" value={v} defaultChecked={has('levels', v)} /><span>{l}</span></label>))}</div>
        </section>
        <section className="card stack">
          <h2>4. Where do you like to source from?</h2>
          <p className="note">We look there first when we find suppliers for you.</p>
          <div className="grid g3">{SUPPLIER_COUNTRIES.map((c) => (
            <label key={c} className="choice"><input type="checkbox" name="supplier_countries" value={c} defaultChecked={has('supplier_countries', c)} /><span>{c}</span></label>))}</div>
        </section>
        <div className="row">
          <button className="btn btn-blue" type="submit">{fromSettings ? 'Save focus' : 'Save and continue'}</button>
          <Link className="btn btn-ghost" href={next}>{fromSettings ? 'Cancel' : 'Skip for now'}</Link>
        </div>
      </form>
    </div>
  );
}
