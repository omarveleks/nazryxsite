// Manufacturer side: countries, agency services and their milestones, report types.

/** Countries manufacturers can target. `data` = we hold the registry and essential list, so market screens are live. */
export const MFR_COUNTRIES: { code: string; name: string; data: boolean }[] = [
  { code: 'TZ', name: 'Tanzania', data: true },
  { code: 'KE', name: 'Kenya', data: false },
  { code: 'KZ', name: 'Kazakhstan', data: false },
  { code: 'UZ', name: 'Uzbekistan', data: false },
  { code: 'CM', name: 'Cameroon', data: false },
  { code: 'SN', name: 'Senegal', data: false },
];
export const countryName = (c?: string | null) => MFR_COUNTRIES.find((x) => x.code === c)?.name ?? c ?? '';
export const EAC = ['Tanzania', 'Kenya', 'Uganda', 'Rwanda', 'Burundi', 'South Sudan'];

export const CERTIFICATIONS = ['WHO prequalification', 'EU GMP', 'US FDA', 'UK MHRA', 'PIC/S', 'WHO GMP', 'National GMP'];

/** Agency services. Each one becomes an engagement the team works through, milestone by milestone. */
export const SERVICES: Record<string, { label: string; what: string; milestones: string[] }> = {
  market_entry: {
    label: 'Market entry',
    what: 'We take your products into the country end to end: assessment, product choice, partner, registration and launch.',
    milestones: ['Requested', 'Market assessment', 'Product selection', 'Partner appointed', 'Dossier submitted', 'Regulator queries', 'Approved', 'Launched'],
  },
  dossier_review: {
    label: 'Dossier review',
    what: 'Upload your dossier. We check every part against the country’s requirements and list the gaps before you file.',
    milestones: ['Requested', 'Documents received', 'Under review', 'Gaps sent', 'Ready to file'],
  },
  local_rep: {
    label: 'Local representative',
    what: 'Every registered product needs a local technical representative. We act as yours, or match you with one.',
    milestones: ['Requested', 'Agreement', 'Appointed', 'Active'],
  },
  eac_rollout: {
    label: 'East African roll-out',
    what: 'One dossier through the East African Community joint assessment, then country by country across the region.',
    milestones: ['Requested', 'Eligibility check', 'Joint assessment filed', 'Joint assessment outcome', 'National approvals', 'Done'],
  },
  post_registration: {
    label: 'After registration',
    what: 'We keep your registrations alive: renewals, variations and safety reports, each tracked against its deadline.',
    milestones: ['Requested', 'Products onboarded', 'Active'],
  },
  partner_intro: {
    label: 'Partner introduction',
    what: 'We introduce you to a distributor from the partner finder and help agree terms.',
    milestones: ['Requested', 'Distributor contacted', 'Introduced', 'Agreement signed'],
  },
  report: {
    label: '24-hour report',
    what: 'A written report from our team within 24 hours of ordering.',
    milestones: ['Requested', 'In progress', 'Delivered'],
  },
};
export const AGENCY_KINDS = ['market_entry', 'dossier_review', 'local_rep', 'eac_rollout', 'post_registration'] as const;

export const REPORT_TYPES: [string, string][] = [
  ['molecule', 'Molecule opportunity: demand, competition, route and price for one product'],
  ['country', 'Country entry plan: where to start, which products, partner and timeline'],
  ['competitors', 'Competitor landscape: who holds what, made where, recent moves'],
  ['price', 'Price check: market and suggested selling prices for your products'],
];

export const OBLIGATION_KINDS: Record<string, string> = { renewal: 'Renewal', variation: 'Variation', safety_report: 'Safety report', other: 'Other' };

/** Plain reasons a product is worth registering, from public data only. */
export function reasons(p: {
  on_national_list?: boolean | null; facility_level?: string | null; on_who_eml?: boolean | null;
  registrants?: number | null; who_pq?: boolean | null; sra_approved?: boolean | null; local_made?: number | null;
}) {
  const out: string[] = [];
  const n = Number(p.registrants ?? 0);
  if (p.on_national_list) out.push(`on the official TMDA list${p.facility_level ? `, level ${p.facility_level}` : ''}`);
  if (p.on_who_eml) out.push('on the WHO essential list');
  out.push(n === 0 ? 'nobody has registered it' : n <= 3 ? `only ${n} ${n === 1 ? 'company has' : 'companies have'} registered it` : `${n} companies registered`);
  if (Number(p.local_made ?? 0) > 0) out.push('also made locally');
  if (p.who_pq || p.sra_approved) out.push('your approval allows the abridged route');
  return out;
}

/** The manufacturer's products with Tanzania market facts. `g.score` orders "register these first"; it is never shown. */
export const MFR_PRODUCTS_SQL = `
  select p.*, m.inn, m.category, cm.registrants, cm.registrations, cm.on_national_list, cm.on_who_eml, cm.facility_level,
         cm.local_made, cm.forms, cm.channel_flag, cm.in_combinations, coalesce(cm.rankable, false) as rankable, g.score
  from mfr_products p
  left join molecules m on m.id = p.molecule_id
  left join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = 'TZ'
  left join visible_gap_scores g on g.molecule_id = p.molecule_id and g.country = 'TZ'`;

// ---------------------------------------------------------------- onboarding questions
export const MFR_STEPS = ['Company', 'Manufacturing', 'Markets', 'Catalogue', 'Goals', 'Your plan'] as const;
export const COMPANY_SIZES = ['Under 50 people', '50-250 people', '250-1,000 people', 'Over 1,000 people'];
export const CONTACT_ROLES = ['Export or business development', 'Regulatory affairs', 'Management', 'Other'];
export const DOSAGE_FORMS = ['Tablets', 'Capsules', 'Oral liquids', 'Injectables', 'Infusions', 'Creams and ointments', 'Eye and ear drops',
  'Inhalers', 'Powders and sachets', 'Suppositories', 'Medical devices'];
export const THERAPEUTIC_AREAS = ['Anti-infectives', 'Antimalarials', 'HIV and TB', 'Cardiovascular', 'Diabetes', 'Pain and inflammation',
  'Respiratory', 'Gastrointestinal', 'Central nervous system', 'Oncology', 'Vitamins and nutrition', 'Dermatology', 'Women\'s health', 'Vaccines and biologics'];
export const TIMELINES: [string, string][] = [
  ['now', 'Now: we want to file this quarter'], ['6m', 'In the next 6 months'], ['12m', 'In the next 12 months'], ['exploring', 'Exploring for now'],
];
export const APPROACHES: [string, string][] = [
  ['own', 'Register in our own name, with a local representative'], ['partner', 'Through a local distributor who holds the registration'],
  ['unsure', 'Not sure yet: advise us'],
];
/** What the manufacturer wants, as on nazryx.com/manufacturers. */
export const GOALS: [string, string][] = [
  ['grow', 'Grow exports: more volume, more orders, steady reorders'], ['launch', 'Launch in new markets'],
  ['win', 'Win more of the markets we are already in'],
];
/** What we run for manufacturers, as on nazryx.com/manufacturers. */
export const NEEDS: [string, string][] = [
  ['launch', 'Choose what to launch, and where'], ['distributor', 'Find the right distributor'],
  ['register', 'Get registered: route, dossier and filing'], ['quality', 'Pass every quality check: GMP, CPP and certification packs'],
  ['pricing', 'Price to win'], ['sales', 'Drive sales after launch'], ['watch', 'Watch the market for us'],
  ['reporting', 'One contact and weekly reports'],
];
/** How many products could launch. Often depends on what the data shows, so that is an answer too. */
export const LAUNCH_SCOPES: [string, string][] = [
  ['data_first', 'Depends on what the data shows'], ['1_3', '1 to 3'], ['4_10', '4 to 10'], ['10_plus', 'More than 10'],
];

// ---------------------------------------------------------------- plans
export type PlanKey = 'data' | 'access' | 'entry';
export const PLAN_ORDER: PlanKey[] = ['data', 'access', 'entry'];
export const MFR_PLANS: Record<PlanKey, { name: string; for: string; includes: string[] }> = {
  data: {
    name: 'Basic Market Data',
    for: 'See each market before you commit.',
    includes: ['Complete market data', 'Target distributor lists', 'Portfolio analysis'],
  },
  access: {
    name: 'Complete Market Access',
    for: 'Know who to supply, at what price, and how to get approved.',
    includes: ['Everything in Basic Market Data', 'Distributor portfolio matching, and the potential to supply them', 'Pricing analysis',
      'Documentation and regulatory check', 'Pathway to approval'],
  },
  entry: {
    name: 'Complete Market Entry',
    for: 'We take your products into the market for you.',
    includes: ['Everything in Complete Market Access', 'Distributor sourcing, done for you',
      'Regulatory submissions and approvals, done for you (government fees paid by you)', 'Sales forecasts and strategic review',
      'Launch planned with the distributor’s sales team', 'Market watch: new registrations, competitors, renewals',
      'One contact and weekly reports per market'],
  },
};

type Answers = { target_countries?: string[] | null; services?: string[] | null; timeline?: string | null; launch_scope?: string | null; goals?: string[] | null };
/** The plan that fits a manufacturer's onboarding answers, with plain reasons. */
export function suggestPlan(a: Answers): { plan: PlanKey; why: string[] } {
  const needs = new Set(a.services ?? []);
  const doneForYou = ['register', 'sales', 'reporting'].some((n) => needs.has(n));
  const access = ['distributor', 'pricing', 'quality', 'register'].some((n) => needs.has(n));
  const soon = a.timeline === 'now' || a.timeline === '6m';
  const dataFirst = a.launch_scope === 'data_first' || a.timeline === 'exploring';
  const why: string[] = [];
  let plan: PlanKey = 'data';
  if (doneForYou && soon && !dataFirst) {
    plan = 'entry';
    why.push('you want registration and sales handled for you', a.timeline === 'now' ? 'you want to file this quarter' : 'you want to file within 6 months');
  } else if (access || doneForYou) {
    plan = 'access';
    why.push(needs.has('distributor') ? 'you want the right distributor' : needs.has('pricing') ? 'you want to price to win' : 'you want a clear route to approval');
    if (dataFirst) why.push('you want to see the data before choosing products');
  } else {
    why.push(dataFirst ? 'you want to see the market first' : 'you mainly want market data and distributor lists');
  }
  const n = (a.target_countries ?? []).length;
  if (n > 1) why.push(`it covers all ${n} of your markets`);
  return { plan, why };
}

/** Services to offer first, from what the manufacturer told us (needs, markets, approach, plan). Ordered, no repeats. */
export function recommendServices(p: {
  services?: string[] | null; target_countries?: string[] | null; registered_in?: string[] | null; approach?: string | null;
  chosen_plan?: string | null; suggested_plan?: string | null;
} | null): { kind: string; why: string; report?: string }[] {
  const needs = new Set(p?.services ?? []), targets = p?.target_countries ?? [], plan = p?.chosen_plan ?? p?.suggested_plan;
  const out: { kind: string; why: string; report?: string }[] = [];
  const add = (kind: string, why: string, report?: string) => { if (!out.some((x) => x.kind === kind)) out.push({ kind, why, report }); };
  if (plan === 'entry' || needs.has('sales') || needs.has('reporting')) add('market_entry', 'you want us to take your products into the market');
  if (needs.has('register') || needs.has('quality') || plan === 'access')
    add('dossier_review', needs.has('quality') ? 'you want every quality check passed' : needs.has('register') ? 'you want to get registered'
      : 'your plan includes a documentation and regulatory check');
  if (needs.has('distributor')) add('partner_intro', 'you want the right distributor');
  if (p?.approach === 'own') add('local_rep', 'you want to register in your own name');
  if ((p?.registered_in ?? []).length || needs.has('watch')) add('post_registration', (p?.registered_in ?? []).length ? 'you already hold registrations' : 'you want the market watched for you');
  if (targets.includes('TZ') && targets.includes('KE') && (needs.has('register') || plan === 'entry')) add('eac_rollout', 'Tanzania and Kenya can share one joint assessment');
  if (needs.has('pricing')) add('report', 'you want to price to win', 'price');
  else if (needs.has('launch') || !out.length) add('report', 'you want to choose what to launch, and where', 'country');
  return out;
}
