import { getUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { saveUpload } from '@/lib/uploads';

// Team uploads the registry .xls export. The file is stored and an ingest job is queued; the Python worker
// validates, diffs, upserts and recomputes in one transaction, so a failed upload never changes live data.
const ALLOWED = new Set(['.xls', '.xlsx', '.html', '.htm']);

export async function POST(req: Request) {
  const u = await getUser();
  if (!u || u.role !== 'team') return new Response('Not found', { status: 404 });
  const to = (q: string) => new Response(null, { status: 303, headers: { Location: `/admin?${q}` } });
  let saved;
  try {
    saved = await saveUpload((await req.formData()).get('file'), 'registry', ALLOWED);
  } catch (e) {
    return to(`error=${encodeURIComponent((e as Error).message)}`);
  }
  if (!saved) return to('error=' + encodeURIComponent('Choose the .xls export first.'));
  await withUser(u.id, async (db) => {
    const r = await one(db, `insert into registry_uploads (country, kind, uploaded_by, file_name, file_path, status)
                             values ('TZ', 'upload', $1, $2, $3, 'queued') returning id`, [u.id, saved!.name, saved!.path]);
    await db.query('select pg_notify($1, $2)', ['ingest', String(r!.id)]);
  });
  return to('queued=1');
}
