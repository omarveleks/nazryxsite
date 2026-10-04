import { clearCookie } from '../_lib/auth.js';
export const onRequestPost = ({ request }) => new Response(null, { status: 303, headers: { Location: new URL('/analytics/login', request.url).toString(), 'Set-Cookie': clearCookie() } });
