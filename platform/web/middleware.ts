import { NextResponse, type NextRequest } from 'next/server';

// While the team views a customer's portal (Admin > View as) nothing can be changed: every form, button and upload is
// refused here, before it reaches the page; the view's own exit link is a plain link.
export function middleware(req: NextRequest) {
  if (req.cookies.get('nzx_view') && req.method !== 'GET' && req.method !== 'HEAD') {
    return new NextResponse('You are viewing an account (read-only). Exit the view to make changes.', { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
