import type { Db } from './db';
import { one } from './db';

// Same idea as the pipeline's molecule key: lower case, no strengths, forms or pharmacopoeia marks, sorted tokens.
const FORM_WORDS = new Set(['tablet', 'tablets', 'tab', 'tabs', 'capsule', 'capsules', 'cap', 'caps', 'injection', 'inj', 'syrup',
  'suspension', 'cream', 'ointment', 'gel', 'drops', 'eye', 'ear', 'oral', 'solution', 'powder', 'for', 'infusion', 'bp', 'usp', 'ip',
  'and', 'with', 'film', 'coated', 'dispersible', 'sr', 'er', 'mr', 'forte', 'plus', 'sachet', 'sachets', 'lotion', 'vial', 'ampoule']);
export function moleculeKeyish(name: string) {
  const t = name.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b[\d.,]+\s*(mg|mcg|µg|g|ml|iu|%|units?)\b/g, ' ').replace(/[^a-z\- ]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1 && !FORM_WORDS.has(w));
  return [...new Set(t)].sort().join(' ');
}


/** Match a product name as people write it ('Amoxicillin 500mg capsules') to a molecule id, or null. */
export async function findMolecule(db: Db, name: string): Promise<number | null> {
  const m = await one(db, `select id from molecules where lower(inn) = lower($1)
                           union all select molecule_id from molecule_aliases where alias = $2
                           union all (select molecule_id from molecule_aliases where alias like $2 || ' %' order by length(alias) limit 1)
                           limit 1`, [name, moleculeKeyish(name)]);
  return m ? Number(m.id ?? m.molecule_id) : null;
}
