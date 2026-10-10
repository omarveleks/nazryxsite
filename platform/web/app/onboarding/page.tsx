import Brand from '@/components/Brand';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { title } from '@/lib/format';
import { completeOnboarding, skipOnboarding } from '@/app/actions/onboarding';

export const metadata = { title: 'Claim your company' };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; pick?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ allowOnboarding: true });
  const q = (sp.q ?? '').trim().slice(0, 80);
  const list = await withUser(u.id, (db) => rows(db, `
    select c.id, c.display_name, coalesce(s.registrations, 0) as products
    from companies c left join company_stats s on s.company_id = c.id and s.country = 'TZ'
    where c.merged_into is null and c.is_ltr and ($1 = '' or c.display_name ilike '%' || $1 || '%'
          or exists (select 1 from company_aliases a where a.company_id = c.id and a.alias ilike '%' || $1 || '%'))
    order by (case when $1 <> '' and c.display_name ilike $1 || '%' then 0 else 1 end), s.registrations desc nulls last
    limit 8`, [q]));
  const pick = Number(sp.pick) || null;
  return (
    <div className="wrap-narrow">
      <Brand href="/onboarding" />
      <div>
        <div className="crumb">Step 2 of 3: your company</div>
        <h1>Claim your company</h1>
        <p className="muted" style={{ marginTop: 8 }}>If you are a registered distributor, we already have you. Pick yourself from the list.</p>
      </div>
      {sp.error && <div className="err" role="alert">{sp.error}</div>}

      <section className="card stack">
        <h2>1. Where do you operate?</h2>
        <div className="row">
          <span className="pill solid">Tanzania</span>
          <span className="pill">Kenya · soon</span><span className="pill">Uganda · soon</span>
        </div>
        <p className="note">Free plan: 1 country. More countries on the paid plan.</p>
      </section>

      <section className="card stack">
        <h2>2. Find your company</h2>
        <form method="get" className="row">
          <label className="sr" htmlFor="q">Search the registered distributor list</label>
          <input className="input" id="q" name="q" defaultValue={q} placeholder="Search the registered distributor list" style={{ flex: '1 1 260px' }} />
          <button className="btn btn-ghost" type="submit">Search</button>
        </form>
      </section>

      <form action={completeOnboarding} className="stack">
        <section className="card stack">
          <div className="list-pick" role="radiogroup" aria-label="Registered distributors">
            {list.map((c) => (
              <label key={c.id}>
                <input type="radio" name="company_id" value={c.id} defaultChecked={pick === c.id} />
                <span style={{ flex: 1 }}><span className="nm">{title(c.display_name)}</span>
                  <span className="sub2" style={{ display: 'block' }}>Tanzania · {c.products} registered products</span></span>
              </label>
            ))}
            {list.length === 0 && <div style={{ padding: 14 }} className="muted">No match. Add your company by name below.</div>}
          </div>
          <div className="field">
            <label htmlFor="company_name">Not in the list? Your company name</label>
            <input className="input" id="company_name" name="company_name" placeholder="Company name as registered" />
          </div>
        </section>

        <section className="card stack">
          <h2>3. Add your portfolio</h2>
          <label className="choice"><input type="radio" name="portfolio_source" value="registry" defaultChecked />
            <span><b>Use the registered list</b><br /><span className="note">We pre-fill your products from registration data once your claim is approved. You review and edit.</span></span></label>
          <label className="choice"><input type="radio" name="portfolio_source" value="catalogue" />
            <span><b>Send your catalogue</b><br /><span className="note">PDF or Excel. Nazryx loads it for you.</span></span></label>
          <div className="drop">
            <label className="lbl" htmlFor="catalogue">Catalogue file (PDF, Excel)</label>
            <input id="catalogue" name="catalogue" type="file" accept=".pdf,.xls,.xlsx,.csv" />
          </div>
          <label className="choice"><input type="radio" name="portfolio_source" value="scratch" />
            <span><b>Start from scratch</b><br /><span className="note">Search and add molecules one by one.</span></span></label>
        </section>

        <section className="card stack">
          <h2>Upload your licence</h2>
          <p className="note">Your company profile unlocks after Nazryx approves the claim. A work email that matches your company speeds this up.
            Claims are approved by hand, so one company never sees another company&apos;s portfolio.</p>
          <div className="drop">
            <label className="lbl" htmlFor="licence">Business or pharmacy licence (PDF or image)</label>
            <input id="licence" name="licence" type="file" accept=".pdf,.png,.jpg,.jpeg" required />
          </div>
        </section>
        <div className="row">
          <button className="btn btn-blue" type="submit">Continue</button>
        </div>
      </form>
      <form action={skipOnboarding}><button className="btn-link" type="submit">Skip for now and explore the market</button></form>
    </div>
  );
}
