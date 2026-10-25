// Customer-facing labels. Each list is named after its publisher (owner's decision).
export const OFFICIAL_LIST = (country = 'Tanzania') => `Official TMDA essential medicines list - ${country}`;
export const OFFICIAL_SHORT = 'Official TMDA list';
export const GLOBAL_LIST = 'WHO essential list';
export const COVERAGE_NOTE = 'Counts registered products, not sales.';

// The pharmaceutical route a sourcing request follows. Closed is the exit at any point.
export const STAGES = ['Product request', 'Regulatory check', 'Regulatory analysis', 'Pricing and logistics', 'Registration', 'Shipment', 'Closed'] as const;
export const PIPELINE = STAGES.filter((s) => s !== 'Closed');
export const STAGE_INFO: Record<string, string> = {
  'Product request': 'What you need: molecule, form, strength, volume.',
  'Regulatory check': 'Who already holds a registration, its status, and any restriction on the product.',
  'Regulatory analysis': 'The route to register it: dossier type, requirements and timeline.',
  'Pricing and logistics': 'Suppliers, anonymous quotes, landed price, lead time and freight.',
  'Registration': 'Dossier submitted and followed through to approval.',
  'Shipment': 'Production, import permit, shipping and delivery.',
};
/** Still being worked up: counts toward the free-plan cap. */
export const EARLY_STAGES = ['Product request', 'Regulatory check', 'Regulatory analysis', 'Pricing and logistics'];
export type Stage = (typeof STAGES)[number];
// A shipment follows the import route; Cancelled is the exit.
export const ORDER_STATUSES = ['Confirming', 'In production', 'Import permit', 'Shipped', 'Arrived', 'Sampling and release', 'Delivered', 'Cancelled'] as const;
export const SHIPMENT_FLOW = ORDER_STATUSES.filter((s) => s !== 'Cancelled');
export const SHIPMENT_DOCS: [string, string][] = [
  ['proforma', 'Proforma invoice'], ['invoice', 'Commercial invoice'], ['coa', 'Certificate of analysis'], ['packing', 'Packing list'],
  ['permit', 'Import permit'], ['bl', 'Bill of lading or air waybill'], ['insurance', 'Insurance certificate'],
];

// What a registration dossier needs from the supplier. The team marks each item have / missing / not needed.
export const DOSSIER_ITEMS: [string, string][] = [
  ['application', 'Application form and letter of authorisation'], ['labels', 'Labels and patient leaflet'],
  ['api', 'Active ingredient documentation (DMF or CEP)'], ['quality', 'Finished product quality data'],
  ['stability', 'Stability data for climatic zone IVb'], ['gmp', 'GMP certificate'],
  ['cpp', 'Certificate of Pharmaceutical Product (CPP)'], ['be', 'Bioequivalence study or biowaiver'],
  ['coa', 'Certificates of analysis'], ['samples', 'Samples and reference standards'],
];
export const DOSSIER_STATUS: Record<string, [string, string]> = { have: ['Ready', 'mint'], missing: ['Missing', 'peach'], not_needed: ['Not needed', ''] };
export const BE_STATUS: Record<string, string> = {
  needed: 'Bioequivalence study needed', biowaiver: 'Biowaiver possible (BCS class I or III)', not_needed: 'No bioequivalence study needed',
};
/** Default BE call from the dosage form: oral solids need BE unless a biowaiver applies; solutions, injections and topicals usually do not. */
export function beSuggestion(forms?: string | null): keyof typeof BE_STATUS | null {
  const f = (forms ?? '').toLowerCase();
  if (/tablet|capsule/.test(f)) return 'needed';
  if (/injection|oral liquid|topical|eye|inhalation|suppository/.test(f)) return 'not_needed';
  return null;
}
export const GMP_BY = ['WHO prequalified', 'Stringent regulator (EU, US, UK, Japan ...)', 'TMDA inspected', 'Other national authority'];

export const LEVELS: Record<string, string> = {
  A: 'Dispensaries and up', B: 'Health centres and up', C: 'District hospitals and up',
  D: 'Regional hospitals and up', S: 'Specialist and national hospitals',
};
export const levelLabel = (l?: string | null) => (l && LEVELS[l]) || 'Level not stated';
export const LEVEL_SHORT: Record<string, string> = {
  A: 'All facilities', B: 'Health centres up', C: 'District hospitals up', D: 'Regional hospitals up', S: 'Specialist only',
};

/** "Registered by 4 companies · 11 products" */
export function registeredLine(companies?: number | null, products?: number | null) {
  const c = Number(companies ?? 0), p = Number(products ?? 0);
  if (c === 0) return 'Nobody registered';
  return `Registered by ${c} ${c === 1 ? 'company' : 'companies'} · ${p} ${p === 1 ? 'product' : 'products'}`;
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ago(d: string | Date | null | undefined) {
  if (!d) return 'never';
  const h = (Date.now() - new Date(d).getTime()) / 36e5;
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'} ago`;
  if (h < 1) return n(Math.max(1, Math.round(h * 60)), 'minute');
  if (h < 48) return n(Math.round(h), 'hour');
  return n(Math.round(h / 24), 'day');
}

export const title = (s: string | null | undefined) =>
  !s ? '' : s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ltd|Llc|Plc)\b/g, (m) => m) : s;

export const channelLabel = (c?: string | null) =>
  c === 'programme' ? 'Programme channel: mostly bought through public and donor programmes. Check before pitching.' : null;

export const FREE = { requests: 5, follows: 3, watches: 5, whitespace: 3, credits: 20 };
export const FOCUS_GOALS: [string, string, string][] = [
  ['new_molecules', 'Add new molecules', 'Find open molecules worth registering.'],
  ['expand_sales', 'Grow sales of what I carry', 'Coverage gaps, competitor moves and pricing in my classes.'],
  ['new_suppliers', 'Find new or better suppliers', 'Quotes from GMP suppliers on molecules I already sell.'],
  ['more_from_suppliers', 'More from my current suppliers', 'What else my existing suppliers make that I could register.'],
];
export const SUPPLIER_COUNTRIES = ['India', 'China', 'Pakistan', 'Bangladesh', 'Egypt', 'Jordan', 'Turkey', 'Kenya', 'South Africa', 'Europe', 'Other'];
export const LEVEL_FILTERS = [['A', 'Level A, dispensaries'], ['B', 'Level B, health centres'], ['C', 'Level C, district hospitals'],
  ['D', 'Level D, regional hospitals'], ['S', 'Level S, specialist']] as const;

/** Amounts and quantities: whole numbers with thousands separators, two decimals under 100. */
export function fmtMoney(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString('en', { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 });
}
