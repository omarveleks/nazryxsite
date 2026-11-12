// Market-read requests from /start. Same-origin only, size-limited, honeypot, one request per minute per visitor.
// Stored in D1 (table created on first use) and shown on the private /analytics dashboard.
import { sha256 } from '../_lib/util.js';

const MAX = { name: 120, company: 160, email: 160, phone: 40, market: 80, products: 8000 };
const seen = new Map();

function reply(request, ok, error, status) {
  if ((request.headers.get('accept') || '').includes('application/json')) {
    return new Response(JSON.stringify(ok ? { ok: true } : { error }), { status: status || (ok ? 200 : 400), headers: { 'content-type': 'application/json' } });
  }
  const body = ok ? 'Thank you. We have your request and will come back to you.' : error;
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nazryx</title><link rel="stylesheet" href="/assets/css/site.css"><section class="wrap hero"><h1>${ok ? 'Request received.' : 'Not sent.'}</h1><p class="lede" style="margin-top:20px">${body}</p><p style="margin-top:24px"><a class="btn btn-blue" href="/">Back to Nazryx</a></p></section>`,
    { status: status || (ok ? 200 : 400), headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null' && origin !== url.origin) return reply(request, false, 'Request blocked.', 403);
  if (Number(request.headers.get('content-length') || 0) > 20000) return reply(request, false, 'That is too long. Please email your list to contact@nazryx.com.', 413);
  let f;
  try { f = await request.formData(); } catch { return reply(request, false, 'Please fill in the form.'); }
  if (String(f.get('website') || '')) return reply(request, true); // honeypot: pretend success
  const v = {};
  for (const k of Object.keys(MAX)) v[k] = String(f.get(k) || '').trim().slice(0, MAX[k]);
  if (!v.name || !v.company || !v.products || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return reply(request, false, 'Please fill in your name, company, a valid email and your products.');
  const ip = request.headers.get('cf-connecting-ip') || '';
  const key = (await sha256((env.ANALYTICS_SESSION_KEY || env.ANALYTICS_PASSWORD || 'nzx') + '|lead|' + ip)).slice(0, 16);
  const now = Date.now();
  if (seen.get(key) > now - 60000) return reply(request, false, 'Please wait a minute before sending again.', 429);
  seen.set(key, now); if (seen.size > 2000) seen.clear();
  if (!env.DB) return reply(request, false, 'Could not save right now. Please email contact@nazryx.com.', 500);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT, company TEXT, email TEXT, phone TEXT, market TEXT, products TEXT, country TEXT, status TEXT DEFAULT 'new')`).run();
  await env.DB.prepare('INSERT INTO leads (ts,name,company,email,phone,market,products,country) VALUES (?,?,?,?,?,?,?,?)')
    .bind(now, v.name, v.company, v.email, v.phone, v.market, v.products, (request.cf && request.cf.country) || null).run();
  return reply(request, true);
}

export const onRequest = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
