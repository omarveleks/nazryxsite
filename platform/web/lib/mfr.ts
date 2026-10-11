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
export const MFR_STEPS = ['Company', 'Manufacturing', 'Markets', 'Catalogue', 'Needs', 'Your plan'] as const;
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
  ['own', 'Register in our own name, with a local representative'], ['partner', 'Through a local distributor who registers or co-markets'],
  ['unsure', 'Not sure yet: advise us'],
];
/** Services a manufacturer can say it needs during onboarding. */
export const NEEDS: [string, string][] = [
  ['market_data', 'Market data: which products to register where'], ['partner', 'Finding a distributor'],
  ['dossier_review', 'Dossier check before filing'], ['registration', 'Handling registration end to end'],
  ['local_rep', 'A local representative'], ['eac', 'East African joint assessment'], ['post_registration', 'Keeping registrations alive'],
  ['reports', 'One-off reports'],
];

// ---------------------------------------------------------------- subscriptions
export type PlanKey = 'insight' | 'entry' | 'regional';
export const MFR_PLANS: Record<PlanKey, { name: string; kind: string; for: string; includes: string[] }> = {
  insight: {
    name: 'Market Insight', kind: 'Subscription',
    for: 'You are choosing markets and products, and want the data before committing.',
    includes: ['Market screens for every country with live data', 'Your catalogue matched to each market, with reasons',
      'Partner finder with anonymous distributor profiles', 'Registration route and timeline per product', '24-hour reports on order'],
  },
  entry: {
    name: 'Market Entry', kind: 'Agency retainer, per country',
    for: 'You know where you want to go and want us to take your products there.',
    includes: ['Everything in Market Insight', 'A Nazryx team member running your entry', 'Dossier review against the country’s requirements',
      'Distributor introductions and terms', 'Filing and regulator queries until approval'],
  },
  regional: {
    name: 'Regional Expansion', kind: 'Agency retainer, several countries',
    for: 'You want several markets, or East Africa through one joint assessment.',
    includes: ['Everything in Market Entry, in each country', 'East African Community joint assessment', 'Local representative in each market',
      'After-registration upkeep: renewals, variations, safety reports', 'One plan and one report across all markets'],
  },
};
export const ADD_ONS: Record<string, { name: string; what: string }> = {
  local_rep: { name: 'Local representative', what: 'We act as your registered local technical representative, or appoint one.' },
  post_registration: { name: 'After registration', what: 'Renewals, variations and safety reports tracked and filed on time.' },
  dossier_review: { name: 'Dossier review', what: 'A full check of one dossier before you file it.' },
};

type Answers = {
  target_countries?: string[] | null; services?: string[] | null; timeline?: string | null; approach?: string | null;
  registered_in?: string[] | null; products_next_year?: number | null; certifications?: string[] | null;
};
/** The plan that fits a manufacturer's onboarding answers, with plain reasons and recommended add-ons. */
export function suggestPlan(a: Answers): { plan: PlanKey; why: string[]; addOns: string[] } {
  const markets = a.target_countries ?? [], needs = new Set(a.services ?? []), registered = a.registered_in ?? [];
  const eacMarkets = markets.filter((c) => ['TZ', 'KE'].includes(c));
  const hands = ['registration', 'dossier_review', 'local_rep', 'eac', 'post_registration', 'partner'].some((n) => needs.has(n));
  const why: string[] = [];
  let plan: PlanKey = 'insight';
  if (markets.length >= 3 || needs.has('eac') || (eacMarkets.length >= 2 && hands)) {
    plan = 'regional';
    if (markets.length >= 3) why.push(`you picked ${markets.length} markets`);
    if (needs.has('eac') || eacMarkets.length >= 2) why.push('East Africa can go through one joint assessment');
  } else if (hands && a.timeline !== 'exploring') {
    plan = 'entry';
    why.push(markets.length === 2 ? 'you picked two markets and want us to do the work' : 'you want us to do the work in your market');
  } else {
    why.push(a.timeline === 'exploring' ? 'you are exploring first' : 'you mainly want market data and partners');
  }
  if (a.timeline === 'now' && plan !== 'insight') why.push('you want to file this quarter');
  if ((a.products_next_year ?? 0) >= 5) why.push(`you plan ${a.products_next_year} registrations in the next year`);
  const addOns: string[] = [];
  if ((needs.has('local_rep') || a.approach === 'own') && plan !== 'regional') addOns.push('local_rep');
  if ((needs.has('post_registration') || registered.length > 0) && plan !== 'regional') addOns.push('post_registration');
  if (needs.has('dossier_review') && plan === 'insight') addOns.push('dossier_review');
  return { plan, why, addOns };
}
