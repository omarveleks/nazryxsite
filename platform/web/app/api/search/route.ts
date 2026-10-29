import { getUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { targetMarkets } from '@/components/MarketPicker';
import { MFR_COUNTRIES } from '@/lib/mfr';

// The search box: molecules, your products, distributors (code, or name where the plan allows), tenders and pages.
// "ceftriaxone KZ" narrows to a market; a distributor code jumps to its profile.
const PAGES: [string, string, string[]][] = [
  ['/m', 'Home', ['home']], ['/m/inbox', 'Inbox', ['inbox', 'alerts']], ['/m/projects', 'Projects', ['project', 'launch']], ['/m/calendar', 'Calendar', ['calendar', 'renewal', 'deadline']],
  ['/m/market', 'Market', ['market']], ['/m/finder', 'Opportunities', ['opportunit', 'finder', 'gap']], ['/m/simulator', 'Pricing', ['pricing', 'price', 'margin', 'landed']],
  ['/m/products', 'My products', ['product', 'catalogue', 'portfolio']], ['/m/regulatory', 'Regulatory', ['regulat', 'requirement', 'dossier', 'route']],
  ['/m/partners', 'Partners', ['partner', 'distributor', 'pipeline']], ['/m/tenders', 'Tenders', ['tender', 'procure']], ['/m/services', 'Services', ['service', 'help']],
  ['/m/plan', 'Plan', ['plan', 'billing', 'invoice']], ['/settings', 'Settings', ['setting', 'password', 'language', 'whatsapp']], ['/m/coverage', 'Coverage', ['coverage', 'source']],
];

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return Response.json([], { status: 401 });
  let q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 2) return Response.json([]);
  // a trailing market code narrows the search to that market
  let market: string | null = null;
  const m = q.match(/\s([A-Za-z]{2})$/);
  if (m && MFR_COUNTRIES.some((c) => c.code === m[1].toUpperCase())) { market = m[1].toUpperCase(); q = q.slice(0, -3).trim(); }
  const ql = q.toLowerCase();
  const out = await withUser(u.id, async (db) => {
    const prof = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.owner_id ?? u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const countries = market ? [market] : targets.length ? targets : ['TZ'];
    const focus = market ?? (prof?.primary_market && targets.includes(prof.primary_market) ? prof.primary_market : countries[0]);
    const hits = q.length >= 2 ? await rows(db, 'select * from search_all($1, $2)', [q, countries]) : [];
    const list = hits.map((h) => ({
      kind: h.kind, label: h.label, sub: h.sub,
      href: h.kind === 'molecule' ? `/m/molecules/${h.id}?market=${focus}` : h.kind === 'product' ? `/m/products/${h.id}?market=${focus}`
        : h.kind === 'company' ? `/m/companies/${h.id}?market=${h.country ?? focus}` : `/m/tenders/${h.id}`,
      country: h.country,
    }));
    const pages = PAGES.filter(([, label, words]) => label.toLowerCase().includes(ql) || words.some((w) => ql.includes(w) || w.startsWith(ql)))
      .slice(0, 3).map(([href, label]) => ({ kind: 'page', label, sub: '', href: market ? `${href}?market=${market}` : href, country: null }));
    return [...list, ...pages].slice(0, 14);
  });
  return Response.json(out, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
