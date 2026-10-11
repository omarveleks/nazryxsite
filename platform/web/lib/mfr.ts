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
