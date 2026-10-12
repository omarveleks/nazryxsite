'use server';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { dbMessage, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { saveUpload } from '@/lib/uploads';
import { MFR_COUNTRIES } from '@/lib/mfr';
import { REG_APPLIES, REG_TOPICS } from '@/lib/regulatory';

// The regulatory library (Admin > Regulatory): documents per country, read into draft requirements by the worker,
// and the requirements customers see once published.
const codes = MFR_COUNTRIES.map((c) => c.code);
const READABLE = new Set(['.pdf', '.doc', '.docx', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.xls', '.xlsx']);
const isRedirect = (e: unknown) => Boolean((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT'));
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : dbMessage(e));
const here = (c: string) => `/admin?tab=regulatory&rc=${codes.includes(c) ? c : ''}`;

export async function uploadRegDoc(f: FormData) {
  const u = await requireTeam('regulatory');
  const country = str(f, 'country', 2);
  const to = here(country);
  if (!codes.includes(country)) back(to, { error: 'Pick the country the document is for.' });
  const files = f.getAll('file').filter((x) => typeof x !== 'string' && x.size > 0);
  if (!files.length) back(to, { error: 'Choose at least one file.' });
  try {
    for (const file of files.slice(0, 20)) {
      const saved = await saveUpload(file, u.id, READABLE);
      if (!saved) continue;
      const title = (files.length === 1 && str(f, 'title', 200)) || saved.name.replace(/\.[^.]+$/, '');
      await withUser(u.id, (db) => db.query(`insert into reg_documents (country, title, file_path, file_name, uploaded_by) values ($1, $2, $3, $4, $5)`,
        [country, title, saved.path, saved.name, u.id]));
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(to, { error: errText(e) });
  }
  back(to, { saved: '1' });
}

export async function rereadRegDoc(f: FormData) {
  const u = await requireTeam('regulatory');
  const id = int(f, 'doc_id'), country = str(f, 'country', 2);
  await withUser(u.id, (db) => db.query(`update reg_documents set status = 'queued', error = null where id = $1`, [id]));
  back(here(country), { saved: '1' });
}

export async function deleteRegDoc(f: FormData) {
  const u = await requireTeam('regulatory');
  const id = int(f, 'doc_id'), country = str(f, 'country', 2);
  // drafts read from this document go with it; published requirements stay
  await withUser(u.id, async (db) => {
    await db.query(`delete from reg_requirements where document_id = $1 and status = 'draft'`, [id]);
    await db.query('delete from reg_documents where id = $1', [id]);
  });
  back(here(country), { saved: '1' });
}

/** Add or edit one requirement. */
export async function saveRequirement(f: FormData) {
  const u = await requireTeam('regulatory');
  const id = int(f, 'id'), country = str(f, 'country', 2);
  const to = here(country);
  const topic = str(f, 'topic', 40), applies = str(f, 'applies', 10);
  const match = applies === 'all' ? null : (applies === 'atc' ? str(f, 'match', 20).toUpperCase() : str(f, 'match', 80).toLowerCase()) || null;
  const title = str(f, 'title', 120), body = str(f, 'body', 800), status = str(f, 'status', 10) === 'draft' ? 'draft' : 'published';
  if (!codes.includes(country) || !REG_TOPICS.includes(topic) || !REG_APPLIES[applies]) back(to, { error: 'Pick a country, a topic and what it applies to.' });
  if (applies !== 'all' && !match) back(to, { error: 'Say which class, ATC group, form or molecule it applies to.' });
  if (!title || !body) back(to, { error: 'Add a title and the requirement.' });
  try {
    await withUser(u.id, (db) => id
      ? db.query(`update reg_requirements set country = $2, topic = $3, applies = $4, match = $5, title = $6, body = $7, status = $8,
                  sort = coalesce($9, sort), updated_at = now() where id = $1`, [id, country, topic, applies, match, title, body, status, int(f, 'sort')])
      : db.query(`insert into reg_requirements (country, topic, applies, match, title, body, status, sort) values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, 100))`,
        [country, topic, applies, match, title, body, status, int(f, 'sort')]));
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  back(to, { saved: '1' });
}

export async function deleteRequirement(f: FormData) {
  const u = await requireTeam('regulatory');
  await withUser(u.id, (db) => db.query('delete from reg_requirements where id = $1', [int(f, 'id')]));
  back(here(str(f, 'country', 2)), { saved: '1' });
}

/** Publish every draft for a country (or those read from one document). */
export async function publishDrafts(f: FormData) {
  const u = await requireTeam('regulatory');
  const country = str(f, 'country', 2), doc = int(f, 'doc_id');
  await withUser(u.id, (db) => db.query(`update reg_requirements set status = 'published', updated_at = now()
                                         where status = 'draft' and country = $1 and ($2::int is null or document_id = $2)`, [country, doc]));
  redirect(`${here(country)}&saved=1`);
}
