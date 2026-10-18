import { requireTeam } from '@/lib/auth';
import { one, withUser } from '@/lib/db';

// A made invoice as its A4 page, for the team to view, print or save as PDF.
export async function GET(_req: Request, { params }: { params: Promise<{ number: string }> }) {
  const u = await requireTeam('accounts');
  const { number } = await params;
  const row = await withUser(u.id, (db) => one(db, 'select html from invoices where number = $1 and html is not null', [decodeURIComponent(number)]));
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(row.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
