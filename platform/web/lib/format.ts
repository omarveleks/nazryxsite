// Customer-facing labels. Source names are never shown: the national list is "the Nazryx Official Medicines List",
// the global list is "the global essential list", registry data is "registration data".
export const OFFICIAL_LIST = (country = 'Tanzania') => `Nazryx Official Medicines List - ${country}`;
export const OFFICIAL_SHORT = 'Official list';
export const GLOBAL_LIST = 'Global essential list';
export const COVERAGE_NOTE = 'Registered coverage, not sales. Based on public registration data.';

export const STAGES = ['Submitted', 'Reviewing', 'Suppliers found', 'Quote ready', 'Closed'] as const;
export type Stage = (typeof STAGES)[number];
export const ORDER_STATUSES = ['Confirming', 'In production', 'In transit', 'Delivered', 'Cancelled'] as const;

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

export function fitLabel(sameCategoryInPortfolio: number): 'Strong' | 'Good' | 'Weak' {
  return sameCategoryInPortfolio >= 3 ? 'Strong' : sameCategoryInPortfolio >= 1 ? 'Good' : 'Weak';
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ago(d: string | Date | null | undefined) {
  if (!d) return 'never';
  const h = (Date.now() - new Date(d).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes ago`;
  if (h < 48) return `${Math.round(h)} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const title = (s: string | null | undefined) =>
  !s ? '' : s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ltd|Llc|Plc)\b/g, (m) => m) : s;

export const channelLabel = (c?: string | null) =>
  c === 'programme' ? 'Programme channel: mostly bought through public and donor programmes. Check before pitching.' : null;

export const FREE = { requests: 5, follows: 3, watches: 5, whitespace: 3, credits: 20 };
