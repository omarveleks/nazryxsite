// Which commit is live: Render sets RENDER_GIT_COMMIT on every deploy. Public, so a deploy can be checked with one request.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ commit: (process.env.RENDER_GIT_COMMIT ?? 'local').slice(0, 7) },
    { headers: { 'Cache-Control': 'no-store' } });
}
