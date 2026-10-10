import { getUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { saveUpload } from '@/lib/uploads';

// The two reference lists every ingest run needs: the national essential medicines list (OCR text) and the
// global essential list (text). Team only. They are kept in the database, not on a server disk.
const KINDS = ['national_list', 'global_list'] as const;
const TXT = new Set(['.txt']);

export async function POST(req: Request) {
  const u = await getUser();
  if (!u || u.role !== 'team') return new Response('Not found', { status: 404 });
  const to = (q: string) => new Response(null, { status: 303, headers: { Location: `/admin?${q}` } });
  const form = await req.formData();
  let n = 0;
  try {
    for (const kind of KINDS) {
      const saved = await saveUpload(form.get(kind), u.id, TXT);
      if (!saved) continue;
      await withUser(u.id, (db) => db.query(
        `insert into reference_files (kind, file_id, name, uploaded_by) values ($1, $2, $3, $4)
         on conflict (kind) do update set file_id = excluded.file_id, name = excluded.name,
           uploaded_by = excluded.uploaded_by, uploaded_at = now()`,
        [kind, saved.path.slice(3), saved.name, u.id]));
      n++;
    }
  } catch (e) {
    return to(`error=${encodeURIComponent((e as Error).message)}`);
  }
  return n ? to('saved=1') : to('error=' + encodeURIComponent('Choose at least one .txt file.'));
}
