import { getUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';

// Files are served only through this route. RLS decides whether the signed-in user may see the referencing row
// and, again, the stored file itself.
const QUERIES: Record<string, string> = {
  request: 'select path, file_name as name from request_files where id = $1',
  licence: 'select licence_path as path, licence_name as name from company_claims where id = $1',
  catalogue: 'select catalogue_path as path, catalogue_name as name from company_claims where id = $1',
  registry: 'select file_path as path, file_name as name from registry_uploads where id = $1',
  engagement: 'select file_path as path, file_name as name from engagement_files where id = $1',
  account: 'select file_path as path, file_name as name from account_documents where id = $1',
  supplier: 'select file_path as path, file_name as name from supplier_documents where id = $1',
  mcatalogue: 'select catalogue_path as path, catalogue_name as name from manufacturer_profiles where user_id = $1',
};
const UUID_KINDS = new Set(['mcatalogue']);

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const u = await getUser();
  const sql = QUERIES[kind];
  const notFound = () => new Response('Not found', { status: 404 });
  const uuid = UUID_KINDS.has(kind);
  if (!u || !sql || !(uuid ? /^[0-9a-f-]{36}$/.test(id) : /^\d+$/.test(id))) return notFound();
  const file = await withUser(u.id, async (db) => {
    const row = await one(db, sql, [uuid ? id : Number(id)]);
    const m = /^db:([0-9a-f-]{36})$/.exec(row?.path ?? '');
    if (!m) return null;
    const f = await one(db, 'select data from stored_files where id = $1', [m[1]]);
    return f ? { name: String(row!.name), data: f.data as Buffer } : null;
  });
  if (!file) return notFound();
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${file.name.replace(/["\r\n]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
