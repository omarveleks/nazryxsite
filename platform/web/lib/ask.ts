import type { Db } from './db';
import { one, rows } from './db';
import { countryName } from './mfr';

// Ask Nazryx: a question answered over the account's own data and the markets, with every number pulled through a tool
// and every answer citing the page it came from. Runs on the Claude API when ANTHROPIC_API_KEY is set; the tools below
// are the only way the model reaches the database, each under the user's row security.

export const ASK_MODEL = process.env.ASK_MODEL ?? 'claude-sonnet-5-5';
export const askReady = () => Boolean(process.env.ANTHROPIC_API_KEY);

type Tool = { name: string; description: string; input_schema: Record<string, unknown>; run: (db: Db, uid: string, args: any, ctx: Ctx) => Promise<unknown> };
export type Ctx = { markets: string[]; lang: string };
export type Cite = { title: string; href: string };

const market = (args: any, ctx: Ctx) => { const m = String(args.market ?? ctx.markets[0] ?? 'TZ').toUpperCase().slice(0, 2); return ctx.markets.includes(m) ? m : ctx.markets[0] ?? 'TZ'; };

export const TOOLS: Tool[] = [
  {
    name: 'my_products', description: 'The account’s own products with the molecule each matched to and, in one market, how many companies sell it, whether it is on the essential list, its demand score and fit score.',
    input_schema: { type: 'object', properties: { market: { type: 'string', description: 'Two-letter market code, e.g. TZ' } } },
    run: async (db, uid, args, ctx) => {
      const m = market(args, ctx);
      const list = await rows(db, `select p.id, p.name, m.inn, m.category, cm.registrants, cm.on_national_list, g.demand, g.score
          from mfr_products p left join molecules m on m.id = p.molecule_id left join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = $2
          left join visible_gap_scores g on g.molecule_id = p.molecule_id and g.country = $2 where p.user_id = $1 order by g.score desc nulls last limit 60`, [uid, m]);
      return { market: m, products: list.map((p) => ({ ...p, page: `/m/products/${p.id}?market=${m}` })) };
    },
  },
  {
    name: 'molecule_in_market', description: 'One molecule in one market: companies selling it, registered products, essential list, demand, the median shelf price with confidence, the registration route and its cost. Find the molecule by name.',
    input_schema: { type: 'object', properties: { molecule: { type: 'string', description: 'INN or part of it' }, market: { type: 'string' } }, required: ['molecule'] },
    run: async (db, _uid, args, ctx) => {
      const m = market(args, ctx);
      const mol = await one(db, `select id, inn, category from molecules where inn ilike '%' || $1 || '%' order by (lower(inn) = lower($1)) desc, length(inn) limit 1`, [String(args.molecule).slice(0, 80)]);
      if (!mol) return { error: 'No molecule by that name in our markets.' };
      const f = await one(db, `select cm.registrants, cm.registrations, cm.on_national_list, cm.on_who_eml, cm.facility_level, cm.forms, g.demand, g.score from country_molecules cm
          left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country where cm.molecule_id = $1 and cm.country = $2`, [mol.id, m]);
      const price = await one(db, `select currency, unit, unit_price, unit_usd, n, basis, coalesce(to_jsonb(molecule_prices) ->> 'confidence', case when basis = 'listings' then 'thin' else 'estimated' end) as confidence,
          (to_jsonb(molecule_prices) ->> 'read_at') as read_at from molecule_prices where molecule_id = $1 and country = $2`, [mol.id, m]);
      const route = await one(db, `select label, months_low, months_high, fee_usd_low, fee_usd_high from country_routes where country = $1 and scope = 'medicine' order by sort limit 1`, [m]);
      return { molecule: mol, market: m, facts: f, price, route, page: `/m/molecules/${mol.id}?market=${m}` };
    },
  },
  {
    name: 'opportunities', description: 'Molecules in a market filtered by competition, demand, essential list and class, best fit first. Use for "what should I register", "where is there no competition".',
    input_schema: { type: 'object', properties: { market: { type: 'string' }, max_registrants: { type: 'integer' }, min_demand: { type: 'number' }, essential_only: { type: 'boolean' }, category: { type: 'string' }, only_mine: { type: 'boolean', description: 'only the account’s own molecules' } } },
    run: async (db, _uid, args, ctx) => {
      const m = market(args, ctx);
      const list = await rows(db, 'select * from find_opportunities($1, $2, $3, $4, $5, null, null, $6, false)', [m, args.category ?? null, args.min_demand ?? null, args.max_registrants ?? null, Boolean(args.essential_only), Boolean(args.only_mine)]);
      return { market: m, count: list.length, top: list.slice(0, 15).map((r) => ({ inn: r.inn, category: r.category, registrants: r.registrants, demand: r.demand, score: r.score, on_national_list: r.on_national_list, price_usd: r.unit_usd, mine: r.mine, page: `/m/molecules/${r.molecule_id}?market=${m}` })), page: `/m/finder?market=${m}` };
    },
  },
  {
    name: 'market_overview', description: 'A market in numbers: registered products, companies, molecules, essential medicines nobody registered, the standard route, medicine imports reported to Comtrade, and how deep our data is.',
    input_schema: { type: 'object', properties: { market: { type: 'string' } } },
    run: async (db, _uid, args, ctx) => {
      const m = market(args, ctx);
      const h = await one(db, `select (select count(*)::int from registrations where country = $1 and active) as products,
          (select count(distinct coalesce(ltr_id, registrant_id))::int from registrations where country = $1 and active) as companies,
          (select count(distinct molecule_id)::int from registrations where country = $1 and active) as molecules,
          (select count(*)::int from country_molecules where country = $1 and on_national_list and registrants = 0 and rankable) as open_essentials,
          (select count(*)::int from molecule_prices where country = $1) as priced_molecules,
          (select count(*)::int from tenders where country = $1 and stage = 'open') as open_tenders`, [m]);
      const route = await one(db, `select label, months_low, months_high, fee_usd_low, fee_usd_high from country_routes where country = $1 and scope = 'medicine' order by sort limit 1`, [m]);
      const imports = await one(db, `select year, value_usd from trade_flows where country = $1 and hs = '3004' and partner = '0' and value_usd is not null order by year desc limit 1`, [m]);
      return { market: m, name: countryName(m), ...h, route, imports_hs3004_usd: imports, page: `/m/market?market=${m}`, coverage_page: `/m/coverage?market=${m}` };
    },
  },
  {
    name: 'distributors', description: 'Distributors in a market strongest in a class, how many of the account’s molecules each already carries, and who could take a molecule on. Names only on Complete Market Access; codes otherwise.',
    input_schema: { type: 'object', properties: { market: { type: 'string' }, category: { type: 'string' }, molecule: { type: 'string' } } },
    run: async (db, _uid, args, ctx) => {
      const m = market(args, ctx);
      const mol = args.molecule ? await one(db, `select id from molecules where inn ilike '%' || $1 || '%' limit 1`, [String(args.molecule).slice(0, 80)]) : null;
      const list = await rows(db, 'select * from partner_search($1, $2, $3, false, 0, $4)', [m, args.category ?? null, mol?.id ?? null, 'open']);
      const names = Object.fromEntries((await rows(db, 'select code, name from partner_names($1)', [m])).map((r) => [r.code, r.name]));
      return { market: m, distributors: list.slice(0, 12).map((p) => ({ code: p.code, name: names[p.code] ?? null, products: p.products, molecules: p.molecules, top_classes: p.top_classes, open_to_mine: p.open_to, carries_molecule: p.carries, page: `/m/companies/${p.code}?market=${m}` })), page: `/m/partners?market=${m}` };
    },
  },
  {
    name: 'tenders', description: 'Public medicine tenders in a market, open ones first, optionally only those on the account’s molecules, with quantities and awarded prices.',
    input_schema: { type: 'object', properties: { market: { type: 'string' }, only_mine: { type: 'boolean' }, molecule: { type: 'string' } } },
    run: async (db, uid, args, ctx) => {
      const m = market(args, ctx);
      const mol = args.molecule ? await one(db, `select id from molecules where inn ilike '%' || $1 || '%' limit 1`, [String(args.molecule).slice(0, 80)]) : null;
      const list = await rows(db, `select t.id, coalesce(t.title_en, t.title) as title, coalesce(t.buyer_en, t.buyer) as buyer, t.stage, t.closing, t.awarded, t.quantity, t.unit_price, t.currency, t.bidders
          from tenders t where t.country = $1 and ($2::boolean is false or exists (select 1 from mfr_products p where p.user_id = $3 and p.molecule_id = any(t.molecule_ids)))
          and ($4::int is null or $4 = any(t.molecule_ids)) order by (t.stage = 'open') desc, coalesce(t.awarded, t.closing, t.published) desc nulls last limit 15`, [m, Boolean(args.only_mine), uid, mol?.id ?? null]);
      return { market: m, tenders: list.map((x) => ({ ...x, page: `/m/tenders/${x.id}` })), page: `/m/tenders?market=${m}` };
    },
  },
  {
    name: 'requirements', description: 'What a market requires to register a medicine: routes with time and fees, the general requirements, and the document checklist.',
    input_schema: { type: 'object', properties: { market: { type: 'string' } } },
    run: async (db, _uid, args, ctx) => {
      const m = market(args, ctx);
      const routes = await rows(db, `select label, description, months_low, months_high, fee_usd_low, fee_usd_high, eligibility from country_routes where country = $1 and scope = 'medicine' order by sort`, [m]);
      const reqs = await rows(db, `select topic, title, left(body, 300) as body from reg_requirements where country = $1 and status = 'published' and scope = 'medicine' and applies = 'all' order by sort limit 25`, [m]);
      const checklist = await rows(db, `select name, note from reg_checklist where country = $1 and scope = 'medicine' order by sort`, [m]);
      return { market: m, routes, requirements: reqs, checklist_items: checklist.length, checklist: checklist.slice(0, 40), page: `/m/regulatory?market=${m}` };
    },
  },
  {
    name: 'my_projects', description: 'The account’s market entry projects: stage, tasks done, next due date, and the dossier readiness.',
    input_schema: { type: 'object', properties: {} },
    run: async (db, uid) => {
      const acct = (await one(db, 'select app_account() as a'))?.a ?? uid;
      const list = await rows(db, `select pr.id, coalesce(m.inn, p.name) as name, pr.country, pr.stage, pr.target_date,
          (select count(*)::int from project_tasks k where k.project_id = pr.id) as tasks, (select count(*)::int from project_tasks k where k.project_id = pr.id and k.done_at is not null) as done,
          (select min(k.due_date) from project_tasks k where k.project_id = pr.id and k.done_at is null) as next_due
          from projects pr join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.user_id = $1 order by pr.updated_at desc limit 40`, [acct]);
      return { projects: list.map((p) => ({ ...p, page: `/m/projects/${p.id}` })), page: '/m/projects' };
    },
  },
];

const SYSTEM = (ctx: Ctx) => `You are Ask Nazryx, the assistant inside the Nazryx Intelligence portal for medicine manufacturers exporting to frontier markets (${ctx.markets.map(countryName).join(', ')} are this account's markets).
Answer only from the tools. Never invent a number, a company or a price. If the tools return nothing, say what is missing and which page to use.
Be short and concrete: lead with the answer, then the two or three facts behind it. Use plain words; keep INN names as given.
Every fact must say where it comes from: end the answer with a line "Sources:" listing the pages used as markdown links from the tool results (the "page" fields), one per line. Never cite a page you did not get from a tool.
Prices are median shelf prices read from pharmacies and official lists; say "about" and give the confidence (measured, thin or estimated). Registration counts are registered products, not sales.
Distributor names are shown only when the tool returns them; otherwise refer to the code.
Answer in the user's language: ${ctx.lang === 'fr' ? 'French' : ctx.lang === 'ru' ? 'Russian' : 'English'}.`;

/** Run one question: tool calls until the model stops, then the text and the pages it cited. */
export async function ask(db: Db, uid: string, ctx: Ctx, question: string, history: { role: 'user' | 'assistant'; content: string }[] = []) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Ask Nazryx is not switched on here.');
  const messages: any[] = [...history.slice(-6).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: question.slice(0, 2000) }];
  const tools = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  let toolCalls = 0;
  const cites = new Map<string, Cite>();
  for (let round = 0; round < 6; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ASK_MODEL, max_tokens: 1200, system: SYSTEM(ctx), tools, messages }),
    });
    if (!res.ok) throw new Error(`The assistant did not answer (${res.status}).`);
    const out = await res.json();
    const uses = (out.content ?? []).filter((c: any) => c.type === 'tool_use');
    if (out.stop_reason !== 'tool_use' || uses.length === 0) {
      const text = (out.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
      return { text, cites: [...cites.values()], toolCalls };
    }
    messages.push({ role: 'assistant', content: out.content });
    const results = [];
    for (const u of uses) {
      const tool = TOOLS.find((t) => t.name === u.name);
      toolCalls++;
      let result: unknown;
      try { result = tool ? await tool.run(db, uid, u.input ?? {}, ctx) : { error: 'unknown tool' }; } catch (e) { result = { error: e instanceof Error ? e.message : 'failed' }; }
      collectPages(result, cites);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(result).slice(0, 12000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'I could not finish that one. Try a narrower question.', cites: [...cites.values()], toolCalls };
}

function collectPages(v: unknown, into: Map<string, Cite>, depth = 0) {
  if (depth > 4 || !v || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.slice(0, 20).forEach((x) => collectPages(x, into, depth + 1)); return; }
  const o = v as Record<string, unknown>;
  for (const [k, val] of Object.entries(o)) {
    if ((k === 'page' || k === 'coverage_page') && typeof val === 'string') into.set(val, { href: val, title: titleFor(val, o) });
    else collectPages(val, into, depth + 1);
  }
}
function titleFor(href: string, o: Record<string, unknown>) {
  if (href.startsWith('/m/molecules/')) return `${(o.molecule as any)?.inn ?? o.inn ?? 'Molecule'} in ${countryName(String(o.market ?? href.split('market=')[1] ?? ''))}`;
  if (href.startsWith('/m/products/')) return String(o.name ?? 'Product');
  if (href.startsWith('/m/companies/')) return String(o.name ?? `Distributor ${o.code ?? ''}`);
  if (href.startsWith('/m/tenders/')) return String(o.title ?? 'Tender');
  if (href.startsWith('/m/projects/')) return `Project: ${o.name ?? ''}`;
  if (href.startsWith('/m/finder')) return 'Opportunities'; if (href.startsWith('/m/market')) return `Market: ${o.name ?? ''}`; if (href.startsWith('/m/coverage')) return 'Coverage';
  if (href.startsWith('/m/partners')) return 'Partners'; if (href.startsWith('/m/tenders')) return 'Tenders'; if (href.startsWith('/m/regulatory')) return 'Regulatory'; if (href.startsWith('/m/projects')) return 'Projects';
  return href;
}
