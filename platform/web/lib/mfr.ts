// Manufacturer side: countries, agency services and their milestones, report types.

/** Markets manufacturers can target. Core markets get full market screens (live once their data is loaded); the others
 *  are worked by our team and kept in the background of the interface. */
export const MFR_COUNTRIES: { code: string; name: string; core: boolean }[] = [
  { code: 'TZ', name: 'Tanzania', core: true },
  { code: 'KZ', name: 'Kazakhstan', core: true },
  { code: 'KG', name: 'Kyrgyzstan', core: true },
  { code: 'UZ', name: 'Uzbekistan', core: true },
  { code: 'KE', name: 'Kenya', core: true },
  { code: 'SN', name: 'Senegal', core: false },
  { code: 'CM', name: 'Cameroon', core: false },
  { code: 'CI', name: 'Côte d’Ivoire', core: false },
  { code: 'HT', name: 'Haiti', core: false },
];
export const CORE_MARKETS = MFR_COUNTRIES.filter((c) => c.core);
export const OTHER_MARKETS = MFR_COUNTRIES.filter((c) => !c.core);
export const countryName = (c?: string | null) => MFR_COUNTRIES.find((x) => x.code === c)?.name ?? c ?? '';

export const CERTIFICATIONS = ['WHO prequalification', 'EU GMP', 'US FDA', 'UK MHRA', 'PIC/S', 'WHO GMP', 'National GMP'];

/** Services. Each becomes an engagement the team works through, milestone by milestone. Only OFFERED ones can be asked
 *  for; the others stay so older engagements keep their names. */
export const SERVICES: Record<string, { label: string; what: string; milestones: string[] }> = {
  market_entry: {
    label: 'Market entry',
    what: 'We take your products into the market for you: the right distributor, a local technical representative, registration and launch.',
    milestones: ['Requested', 'Market assessment', 'Distributor and representative chosen', 'Dossier submitted', 'Regulator queries', 'Approved', 'Launched'],
  },
  dossier_review: {
    label: 'Dossier and regulatory review',
    what: 'Send us your dossier. We check it against the country’s requirements, confirm the route to approval and list every gap before you file.',
    milestones: ['Requested', 'Documents received', 'Under review', 'Gaps sent', 'Ready to file'],
  },
  post_registration: {
    label: 'Renewals and compliance',
    what: 'Once you are registered, we keep it that way: renewals, variations and safety reports, each tracked against its deadline.',
    milestones: ['Requested', 'Products onboarded', 'Active'],
  },
  local_rep: { label: 'Local representative', what: '', milestones: ['Requested', 'Agreement', 'Appointed', 'Active'] },
  eac_rollout: { label: 'East African roll-out', what: '', milestones: ['Requested', 'Eligibility check', 'Joint assessment filed', 'Joint assessment outcome', 'National approvals', 'Done'] },
  partner_intro: { label: 'Distributor introduction', what: '', milestones: ['Requested', 'Distributor contacted', 'Introduced', 'Agreement signed'] },
  report: { label: 'Report', what: '', milestones: ['Requested', 'In progress', 'Delivered'] },
};
export const AGENCY_KINDS = ['market_entry', 'dossier_review', 'post_registration'] as const;


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

/** The manufacturer's products with one market's facts. `g.score` orders "register these first"; it is never shown. */
export function mfrProductsSql(country: string) {
  const c = MFR_COUNTRIES.some((x) => x.code === country) ? country : 'TZ';   // whitelisted: safe to inline
  return `
  select p.*, m.inn, m.category, cm.registrants, cm.registrations, cm.on_national_list, cm.on_who_eml, cm.facility_level,
         cm.local_made, cm.forms, cm.channel_flag, cm.in_combinations, coalesce(cm.rankable, false) as rankable, g.score, g.demand
  from mfr_products p
  left join molecules m on m.id = p.molecule_id
  left join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = '${c}'
  left join visible_gap_scores g on g.molecule_id = p.molecule_id and g.country = '${c}'`;
}
export const MFR_PRODUCTS_SQL = mfrProductsSql('TZ');

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
    includes: ['Complete market data', 'Target distributor lists', 'Portfolio analysis', 'Market watch on your molecules'],
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
      'Launch planned with the distributor’s sales team', 'One contact and weekly reports per market'],
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

/** Services to offer first, from what the manufacturer told us. Ordered, no repeats. */
export function recommendServices(p: { services?: string[] | null; registered_in?: string[] | null; chosen_plan?: string | null; suggested_plan?: string | null } | null) {
  const needs = new Set(p?.services ?? []), plan = p?.chosen_plan ?? p?.suggested_plan;
  const out: { kind: string; why: string }[] = [];
  const add = (kind: string, why: string) => { if (!out.some((x) => x.kind === kind)) out.push({ kind, why }); };
  if (plan === 'entry' || ['sales', 'reporting', 'distributor'].some((n) => needs.has(n))) add('market_entry', 'you want us to take your products into the market');
  if (needs.has('register') || needs.has('quality') || plan === 'access') add('dossier_review', needs.has('quality') ? 'you want every quality check passed' : 'you want a clear route to approval');
  if ((p?.registered_in ?? []).length || needs.has('watch')) add('post_registration', 'you already hold registrations');
  return out;
}

// ---------------------------------------------------------------- what each plan unlocks
export const TIER: Record<string, number> = { data: 1, access: 2, entry: 3 };
export const tierOf = (plan?: string | null) => TIER[plan ?? ''] ?? 0;
/** The lowest plan that includes a feature or service. 24-hour reports are open to everyone. */
export const NEEDS_PLAN: Record<string, PlanKey> = {
  market: 'data', portfolio: 'data', watch: 'data', market_read: 'data', distributors: 'access',
  matching: 'access', pricing: 'access', pathway: 'access', dossier_review: 'access',
  partner_intro: 'entry', market_entry: 'entry', forecast: 'entry', competitors: 'data', requirements: 'access',
};
export const canUse = (tier: number, feature: string) => !NEEDS_PLAN[feature] || tier >= TIER[NEEDS_PLAN[feature]];

/** WHO ATC main groups, to name a class for products we cannot match to a tracked molecule. */
export const ATC_GROUPS: Record<string, string> = {
  A: 'Alimentary tract and metabolism', B: 'Blood and blood-forming organs', C: 'Cardiovascular system', D: 'Dermatologicals',
  G: 'Genito-urinary system and sex hormones', H: 'Systemic hormonal preparations', J: 'Anti-infectives for systemic use',
  L: 'Antineoplastic and immunomodulating agents', M: 'Musculo-skeletal system', N: 'Nervous system', P: 'Antiparasitic products',
  R: 'Respiratory system', S: 'Sensory organs', V: 'Various',
};
export const productClass = (p: { category?: string | null; atc?: string | null }) => p.category ?? (p.atc ? ATC_GROUPS[p.atc[0]] : null) ?? null;

/** What each service needs from the manufacturer, shown before they ask for it. */
export const SERVICE_NEEDS: Record<string, string[]> = {
  market_entry: ['Your product list with strengths and forms', 'Your GMP and certification pack', 'One person we can ask questions of'],
  dossier_review: ['The dossier, or its index to start', 'GMP certificate and CPP', 'Stability data for climatic zone IVb, if you have it'],
  post_registration: ['Your registration certificates', 'Renewal dates if you know them', 'Planned changes to the product or site'],
};

/** What a manufacturer can upload from My products: a catalogue, and the small starter pack the team checks first. */
export const MFR_FILE_KINDS: Record<string, string> = {
  catalogue: 'Product catalogue or list', gmp: 'GMP certificate', cpp: 'CPP (certificate of pharmaceutical product)',
  coa: 'Certificate of analysis', label: 'Labels and leaflets', other: 'Other',
};

/** High demand: the demand measure behind the ranking (official essential list, how widely it is used, WHO list) at 0.8 or more. */
export const HIGH_DEMAND = 0.8;

/** Launch tracker stages, from chosen to on the shelf. */
export const LAUNCH_STAGES: [string, string][] = [
  ['selected', 'Chosen'], ['dossier', 'Dossier in preparation'], ['filed', 'Filed'], ['approved', 'Approved'], ['launched', 'Launched'],
];

/** The first-time manufacturer sign-up: one question per screen. The rest of the profile is filled in later (Home checklist). */
export const WIZARD = ['company', 'markets', 'goals', 'help', 'timeline', 'scope', 'products', 'plan'] as const;
export type WizardStep = (typeof WIZARD)[number];
