// Regulatory requirements per market: overall (every product) and for a class, an ATC group, a dosage form or one molecule.
// Kept by the Nazryx team in Admin > Regulatory, partly drafted from the documents they upload.

export const REG_TOPICS = ['Route', 'Dossier', 'Site and GMP', 'Labelling', 'Marking', 'Samples', 'Local representative', 'Import', 'Fees',
  'Timeline', 'After approval', 'Other'];
export const REG_APPLIES: Record<string, string> = {
  all: 'Every product', class: 'Therapeutic class', atc: 'ATC group', form: 'Dosage form', molecule: 'One molecule',
};
export const REG_DOC_STATUS: Record<string, [string, string]> = {
  queued: ['Waiting to be read', 'lav'], reading: ['Reading', 'blue'], done: ['Read', 'mint'], failed: ['Could not read', 'alert'],
  manual: ['Add by hand', 'peach'],
};

export type Requirement = { id: number; topic: string; applies: string; match: string | null; title: string; body: string };
type ProductLike = { inn?: string | null; name?: string | null; atc?: string | null; category?: string | null; dosage_form?: string | null };

/** Does a specific requirement (not 'all') apply to this product? */
export function appliesTo(r: Requirement, p: ProductLike) {
  const m = (r.match ?? '').toLowerCase();
  if (!m) return false;
  if (r.applies === 'molecule') return (p.inn ?? '').toLowerCase() === m || (p.name ?? '').toLowerCase().startsWith(m);
  if (r.applies === 'atc') return (p.atc ?? '').toUpperCase().startsWith(m.toUpperCase());
  if (r.applies === 'class') return (p.category ?? '').toLowerCase().includes(m);
  if (r.applies === 'form') return `${p.dosage_form ?? ''} ${p.name ?? ''}`.toLowerCase().includes(m);
  return false;
}

/** Requirements for one product: the specific ones that apply, one per title (the same rule can match twice). */
export function forProduct(reqs: Requirement[], p: ProductLike) {
  const seen = new Set<string>();
  return reqs.filter((r) => r.applies !== 'all' && appliesTo(r, p)).filter((r) => {
    const k = `${r.topic}|${r.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Group by topic in the usual reading order. */
export function byTopic(reqs: Requirement[]) {
  const order = (t: string) => { const i = REG_TOPICS.indexOf(t); return i < 0 ? 99 : i; };
  const groups = new Map<string, Requirement[]>();
  for (const r of [...reqs].sort((a, b) => order(a.topic) - order(b.topic))) {
    if (!groups.has(r.topic)) groups.set(r.topic, []);
    groups.get(r.topic)!.push(r);
  }
  return [...groups.entries()];
}

export const REQ_SQL = `select id, topic, applies, match, title, body from reg_requirements
  where country = $1 and status = 'published' order by sort, id`;
