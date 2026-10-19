import { teamCan } from '@/lib/team';
import { getUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { saveUpload } from '@/lib/uploads';

// Team uploads the registry .xls export. The file is stored and an ingest job is queued; the Python worker
// validates, diffs, upserts and recomputes in one transaction, so a failed upload never changes live data.
const ALLOWED = new Set(['.xls', '.xlsx', '.html', '.htm']);
// Tanzania has its own pipeline; the others are read by ingest/country_load.py
const COUNTRIES = ['TZ', 'KZ', 'KG', 'UZ', 'KE', 'NG'];

export async function POST(req: Request) {
  const u = await getUser();
  if (!u || !teamCan(u, 'data')) return new Response('Not found', { status: 404 });
  const to = (q: string) => new Response(null, { status: 303, headers: { Location: `/admin?${q}` } });
  let saved;
  let country = 'TZ';
  try {
    const form = await req.formData();
    country = COUNTRIES.includes(String(form.get('country'))) ? String(form.get('country')) : 'TZ';
    saved = await saveUpload(form.get('file'), u.id, ALLOWED);
  } catch (e) {
    return to(`error=${encodeURIComponent((e as Error).message)}`);
  }
  if (!saved) return to('error=' + encodeURIComponent('Choose the .xls export first.'));
  await withUser(u.id, async (db) => {
    const r = await one(db, `insert into registry_uploads (country, kind, uploaded_by, file_name, file_path, status)
                             values ($4, 'upload', $1, $2, $3, 'queued') returning id`, [u.id, saved!.name, saved!.path, country]);
    await db.query('select pg_notify($1, $2)', ['ingest', String(r!.id)]);
  });
  return to('queued=1');
}
