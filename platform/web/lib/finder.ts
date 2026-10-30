// The opportunity finder's filters and the distributor pipeline's stages, shared by the pages, the actions and the exports.

export type FinderParams = { category: string | null; demand: number | null; max: number | null; essential: boolean; form: string | null; price: number | null; mine: boolean };

/** Read the finder's filters from a query string or a form. Anything odd falls back to "no filter". */
export function finderParams(sp: Record<string, string | undefined>): FinderParams {
  const num = (v?: string) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n >= 0 ? n : null; };
  const intN = (v?: string) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) && n >= 0 ? n : null; };
  return {
    category: (sp.category ?? '').slice(0, 80) || null,
    demand: num(sp.demand),
    max: intN(sp.max),
    essential: sp.essential === '1',
    form: (sp.form ?? '').slice(0, 40).replace(/[^\w\s-]/g, '') || null,
    price: num(sp.price),
    mine: sp.mine === '1',
  };
}

export function finderQuery(market: string, p: FinderParams) {
  const q = new URLSearchParams({ market });
  if (p.category) q.set('category', p.category);
  if (p.demand != null) q.set('demand', String(p.demand));
  if (p.max != null) q.set('max', String(p.max));
  if (p.essential) q.set('essential', '1');
  if (p.form) q.set('form', p.form);
  if (p.price != null) q.set('price', String(p.price));
  if (p.mine) q.set('mine', '1');
  return q.toString();
}

/** One line that says what a search looks for. */
export function describeSearch(p: FinderParams) {
  const bits = [
    p.category ? p.category : 'every class',
    p.essential ? 'on the essential list' : null,
    p.max != null ? (p.max === 0 ? 'nobody registered' : `at most ${p.max} ${p.max === 1 ? 'company' : 'companies'}`) : null,
    p.demand != null ? `demand ${p.demand}+` : null,
    p.form ? p.form.toLowerCase() : null,
    p.price != null ? `priced from $${p.price}` : null,
    p.mine ? 'not in your catalogue' : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

export const DEMAND_STEPS: [string, string][] = [['', 'Any demand'], ['0.3', 'Some demand (0.3+)'], ['0.5', 'High demand (0.5+)'], ['0.7', 'Very high (0.7+)']];
export const COMPETITION_STEPS: [string, string][] = [['', 'Any competition'], ['0', 'Nobody registered'], ['2', 'Two companies or fewer'], ['5', 'Five or fewer']];
export const FORM_STEPS = ['Tablet', 'Capsule', 'Injection', 'Syrup', 'Suspension', 'Cream', 'Drops', 'Inhaler', 'Powder', 'Suppository'];

export const PIPELINE_STAGES: [string, string][] = [
  ['shortlisted', 'Shortlisted'], ['intro_requested', 'Introduction requested'], ['in_talks', 'In talks'], ['nda', 'NDA signed'], ['signed', 'Agreement signed'], ['dropped', 'Dropped'],
];
export const PIPELINE_TONE: Record<string, string> = { shortlisted: '', intro_requested: 'blue', in_talks: 'lav', nda: 'peach', signed: 'mint', dropped: '' };
