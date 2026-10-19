// Use groups: products that share an ingredient but compete in different places (eye lubricants, eye-surgery viscoelastics,
// joint injections, nasal saline). The same rules as ingest/devices.py.
export const GROUP_LABEL: Record<string, string> = {
  eye_drops: 'Eye lubricants (dry eye)', eye_surgery: 'Eye-surgery viscoelastics', joint: 'Joint injections (hyaluronic acid)', nasal: 'Nasal saline',
};
const GROUPS: [string, RegExp][] = [
  ['eye_surgery', /viscoelast|visco-?surg|\bovd\b|provisc|healon|viscoat|discovisc|amvisc|hydroxy ?propyl ?methyl ?cellulose 2|hpmc 2|appavisc|adgevisk|kogevisk|ophthalmic (?:surgical|viscosurgical)/i],
  ['joint', /intra-?articular|viscosupplement|synvisc|durolane|ostenil|fermathron|hyalgan|orthovisc|armaviscon|hyorth|hyal forte|\bhylan\b|hyaluron\w*.*(?:knee|joint|articul|osteoarth)|(?:knee|joint|osteoarth).*hyaluron/i],
  ['nasal', /saline nasal|nasal saline|(?:nasal|nose).*(?:saline|sea ?water|isotonic|hypertonic|wash|rinse|spray|drops)|sea ?water|sinus rinse|nasal wash|neti pot|sterimar|neilmed|nasamist|pediamist|linaqua|aquaease|physiomer|marimer|synolin/i],
  ['eye_drops', /eye ?drop|eye gel|lubricat\w* eye|eye lubricant|dry eye|artificial tear|\btears\b|hylo-?(?:comod|gel|care|dual|fresh)|systane|hyfresh|maxmoist|hayazol|hyazol|gylan|refresh (?:liquigel|tears|plus)|optive|thealoz|eye (?:mist|spray)/i],
];
const NOT_GROUPED = /cannula|oxygen|mask|prosthe|arthroplast|brace|immobili|implant|\blens|\biol\b|blade|\btest|assay|tube|airway|cpap|ventilat|aspirat|suction|prong|knife|catheter|swab|kit for|analy[sz]er|scanner|system$|hinge|nail|screw|plate/i;
// medicines inside a group's words that are not that kind of product (antibiotic or steroid eye drops are not lubricants)
const NOT_LUBRICANT = /hydrocort|betameth|chloramph|alerchek|aurocrome|aurosol|apdrop|combiplus|eyfem|mo-floren|cyclogyl|mydriacyl|oculast|cipro|oflox|moxi|gati|tobra|genta|chloramph|neomy|dexa|predn|fluoro|lotepred|ketorol|diclof|nepaf|bromf|olopat|ketotif|azelast|cromo|timolol|latano|brimon|dorzol|brinz|travop|bimat|atropin|tropicam|cyclop|phenyleph|naphaz|tetrahydroz|xylometaz|oxymetaz|fluticas|mometas|budeso|beclom|cyclospor|acular|nevanac|vigamox|tobradex|maxitrol|maxidex|patanol|exocin|flarex|relestat/i;

export function useGroup(...texts: (string | null | undefined)[]) {
  const t = texts.filter(Boolean).join(' ');
  if (!t || NOT_GROUPED.test(t)) return null;
  return GROUPS.find(([, rx]) => rx.test(t))?.[0] ?? null;
}

/** Whether a listing or registration is in the group, as a like-for-like competitor (no medicated drops). */
export function inGroup(group: string, text: string, ingredient?: string | null, description?: string | null) {
  if (useGroup(text, ingredient) !== group || /shampoo|bath|soap|lotion|cream|wipe/i.test(text)) return false;
  const all = `${text} ${ingredient ?? ''} ${description ?? ''}`;
  if (group === 'eye_drops') {
    if (NOT_LUBRICANT.test(`${text} ${ingredient ?? ''}`) || MEDICATED.test(text)) return false;
    if (MEDICATED.test(description ?? '') && !/lubricat|dry eye|artificial tear/i.test(description ?? '')) return false;
    return Boolean(ingredient && LUBRICANTS.test(ingredient)) || LUBRICANTS.test(all) || /lubricat|dry eye|dryness|artificial tear|\btears\b|moistur|hydrat/i.test(all);
  }
  if (group === 'nasal') return !NOT_LUBRICANT.test(`${text} ${ingredient ?? ''}`) && (!ingredient || /sodium chloride|sea ?water|saline/i.test(ingredient));
  return true;
}
// what a medicated eye drop's description says (an antibiotic or steroid is not a competitor to a lubricant)
const MEDICATED = /antibiotic|antibacterial|infection|steroid|corticosteroid|inflammation|allerg|antihistamin|glaucoma|intraocular pressure|dilat|pupil|anti-?inflammatory|conjunctivitis/i;
// what eye lubricants are made of; an eye drop with any other active ingredient is a medicine, not a competitor
const LUBRICANTS = /hyaluron|carmellose|carboxymethyl|hypromellose|hydroxypropyl|carbomer|polyvinyl|povidone|trehalose|dexpanthenol|glycerin|glycerol|polyethylene glycol|propylene glycol|dextran|sodium chloride/i;

/** The brand part of a product name: 'Systane Ultra Eye Drops 10ml' -> 'Systane'. */
export function brandOf(name: string) {
  const w = name.replace(/[®™]/g, '').trim().split(/[\s(]+/);
  const first = w[0] ?? '';
  if (/^tears?$/i.test(w[1] ?? '') || /^(tears?|fresh)$/i.test(first)) return w.slice(0, 2).join(' ');   // 'Loc Tears', 'Tears Naturale'
  return /^(hylo|neilmed|sterimar|optive|refresh|systane)$/i.test(first.replace(/-.*/, '')) ? first.replace(/-.*/, '') : first;
}
