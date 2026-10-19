// Regulatory requirements per market: overall (every product) and for a class, an ATC group, a dosage form or one molecule.
// Kept by the Nazryx team in Admin > Regulatory, partly drafted from the documents they upload.

export const REG_TOPICS = ['Route', 'Timeline', 'Fees', 'Local representative', 'Site and GMP', 'Dossier', 'Bioequivalence', 'Stability',
  'Samples', 'Labelling', 'Marking', 'Pricing', 'Import', 'After approval', 'Other'];
export const REG_APPLIES: Record<string, string> = {
  all: 'Every product', class: 'Therapeutic class', atc: 'ATC group', form: 'Dosage form', molecule: 'One molecule',
};
export const REG_DOC_STATUS: Record<string, [string, string]> = {
  queued: ['Waiting to be read', 'lav'], reading: ['Reading', 'blue'], done: ['Read', 'mint'], failed: ['Could not read', 'alert'],
  manual: ['Add by hand', 'peach'],
};

export type Requirement = { id: number; topic: string; applies: string; match: string | null; title: string; body: string };
type ProductLike = { inn?: string | null; name?: string | null; atc?: string | null; category?: string | null; dosage_form?: string | null };

// Words a rule can use for a group of products, and how to recognise them from the product's form, name, INN and ATC code.
const CONCEPTS: Record<string, { text?: RegExp; atc?: string[] }> = {
  'oral solid': { text: /tablet|\btabs?\b|capsul|\bcaps?\b|sachet|granul|lozenge|dispersible|таблет|капс|драже|гранул|саше/ },
  bioequivalence: { text: /tablet|\btabs?\b|capsul|\bcaps?\b|suspension|таблет|капс|сусп/ },
  sterile: { text: /inject|infusion|ampoule|\bvials?\b|\binj\b|parenteral|ophthalm|\beye\b|sterile|инъек|инфуз|ампул|флакон|глазн/ },
  injection: { text: /inject|infusion|ampoule|\bvials?\b|\binj\b|parenteral|инъек|инфуз|ампул/ },
  eye: { text: /ophthalm|\beye\b|глазн/ },
  inhal: { text: /inhal|aerosol|nebul|ингал|аэрозол/ },
  biolog: { text: /biolog|insulin|vaccin|mab\b|interferon|epoetin|filgrastim|heparin|immunoglobulin/, atc: ['L04AB', 'L04AC', 'L01F', 'J07', 'A10A', 'B01AB', 'J06'] },
  vaccine: { text: /vaccin|вакцин/, atc: ['J07'] },
  controlled: { atc: ['N02A', 'N05BA', 'N05CD', 'N05CF', 'N06BA', 'N01AH', 'N03AE', 'N07BC', 'R05DA'] },
};

/** Does a specific requirement (not 'all') apply to this product? */
export function appliesTo(r: Requirement, p: ProductLike) {
  const m = (r.match ?? '').toLowerCase();
  if (!m) return false;
  const concept = CONCEPTS[m];
  if (concept && r.applies !== 'molecule') {
    const text = `${p.dosage_form ?? ''} ${p.name ?? ''} ${p.inn ?? ''} ${p.category ?? ''}`.toLowerCase();
    const atc = (p.atc ?? '').toUpperCase();
    return Boolean(concept.text?.test(text)) || Boolean(concept.atc?.some((a) => atc.startsWith(a)));
  }
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
  where country = $1 and status = 'published' and scope = 'medicine' order by sort, id`;
/** Medical devices register under their own rules (classes, conformity evidence, a local representative). */
export const DEVICE_REQ_SQL = REQ_SQL.replace("scope = 'medicine'", "scope = 'device'");
