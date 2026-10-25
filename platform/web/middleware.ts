import { NextResponse, type NextRequest } from 'next/server';

// While the team views a customer's portal (Admin > View as) nothing can be changed: every form, button and upload is
// refused here, before it reaches the page; the view's own exit link is a plain link.
export function middleware(req: NextRequest) {
  if (req.cookies.get('nzx_view') && req.method !== 'GET' && req.method !== 'HEAD') {
    return new NextResponse('You are viewing an account (read-only). Exit the view to make changes.', { status: 403 });
  }
  // the page opened, for Admin > Usage (recorded in getUser): page loads only, not link prefetches, files, the API or
  // the front page (it only sends people on)
  const p = req.nextUrl.pathname;
  const prefetch = req.headers.get('next-router-prefetch') || /prefetch/i.test(req.headers.get('purpose') ?? req.headers.get('sec-purpose') ?? '');
  const headers = new Headers(req.headers);
  headers.delete('x-nzx-path');                  // only ever set here, never by the browser
  if (req.method === 'GET' && !prefetch && p !== '/' && !p.startsWith('/api') && !p.startsWith('/files') && !/\.[a-z0-9]+$/i.test(p)) {
    headers.set('x-nzx-path', p);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
