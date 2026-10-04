// First-party event intake. Same-origin only, size-limited, rate-limited per visitor key. Always 204.
import { sha256 } from '../_lib/util.js';

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|whatsapp\/|curl|wget|python|httpclient|axios|go-http|java\/|monitor|uptime|phantom|selenium|puppeteer|playwright/i;
const TYPES = new Set(['pageview', 'time', 'scroll', 'click', 'submit']);
const SESSION = 30 * 60 * 1000;
const rate = new Map(); // per-isolate, best effort: 120 events / visitor / minute
const ok = () => new Response(null, { status: 204 });
const clip = (s, n) => (s == null ? null : String(s).slice(0, n) || null);

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const url = new URL(request.url);
    const h = request.headers;
    const origin = h.get('origin');
    if (origin && origin !== url.origin) return ok();
    if (h.get('sec-fetch-site') && !['same-origin', 'none'].includes(h.get('sec-fetch-site'))) return ok();
    if (/prefetch|prerender/i.test((h.get('sec-purpose') || '') + (h.get('purpose') || '') + (h.get('x-moz') || ''))) return ok();
    const ua = h.get('user-agent') || '';
    if (!ua || BOT.test(ua) || (request.cf && request.cf.verifiedBotCategory)) return ok();
    if (Number(h.get('content-length') || 0) > 2048) return ok();
    const raw = await request.text();
    if (raw.length > 2048) return ok();
    const e = JSON.parse(raw);
    if (!TYPES.has(e.t) || typeof e.p !== 'string' || !e.p.startsWith('/')) return ok();
    const path = (e.p.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/').slice(0, 120);
    if (/^\/(analytics|api)(\/|$)/.test(path)) return ok();
    if (!env.DB) return ok();

    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const salt = await dailySalt(env.DB, day);
    const ip = h.get('cf-connecting-ip') || '';
    const vkey = (await sha256(salt + '|' + ip + '|' + ua + '|' + url.host)).slice(0, 22);

    const minute = Math.floor(now / 60000);
    const rk = vkey + minute, c = (rate.get(rk) || 0) + 1;
    rate.set(rk, c);
    if (rate.size > 5000) rate.clear();
    if (c > 120) return ok();

    const last = await env.DB.prepare('SELECT ts,sid,source,ref_host,utm_source,utm_medium,utm_campaign,lead_ref FROM events WHERE vkey=? ORDER BY ts DESC LIMIT 1').bind(vkey).first();
    const qs = new URLSearchParams(typeof e.q === 'string' ? e.q.slice(0, 600) : '');
    let refHost = null;
    try { if (e.r) { const r = new URL(e.r); if (r.host !== url.host) refHost = r.host.replace(/^www\./, '').slice(0, 80); } } catch {}
    const utm = { s: clip(qs.get('utm_source'), 60), m: clip(qs.get('utm_medium'), 60), c: clip(qs.get('utm_campaign'), 80) };
    const lead = clip((qs.get('ref') || '').replace(/[^\w.\-@ ]/g, ''), 60);

    let sid, a;
    const fresh = e.t === 'pageview' && (utm.s || lead || refHost);
    if (last && now - last.ts < SESSION && !fresh) {
      sid = last.sid;
      a = { source: last.source, ref_host: last.ref_host, us: last.utm_source, um: last.utm_medium, uc: last.utm_campaign, lead: last.lead_ref };
    } else {
      sid = (await sha256(vkey + now + Math.random())).slice(0, 16);
      a = { source: classify(utm, refHost), ref_host: refHost, us: utm.s, um: utm.m, uc: utm.c, lead: lead || (last && now - last.ts < SESSION ? last.lead_ref : null) };
    }

    const cf = request.cf || {};
    const ins = env.DB.prepare(`INSERT INTO events (ts,day,type,path,pv,sid,vkey,value,target,ref_host,source,utm_source,utm_medium,utm_campaign,lead_ref,country,city,device,browser,os,lang,is_new)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      now, day, e.t, path, clip(e.i, 16), sid, vkey,
      Math.max(0, Math.min(Number(e.v) || 0, 86400)), e.t === 'click' || e.t === 'submit' ? clip(e.k, 120) : null,
      a.ref_host, a.source, a.us, a.um, a.uc, a.lead,
      clip(cf.country, 2), clip(cf.city, 60), device(ua), browser(ua), os(ua), clip((e.l || '').split('-')[0].toLowerCase(), 8),
      e.t === 'pageview' ? (e.n ? 1 : 0) : null
    );
    await ins.run();
    if (Math.random() < 0.01) waitUntil(housekeeping(env.DB, now));
  } catch {}
  return ok();
}

export const onRequest = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });

async function dailySalt(DB, day) {
  let r = await DB.prepare('SELECT salt FROM salts WHERE day=?').bind(day).first();
  if (r) return r.salt;
  const salt = crypto.randomUUID() + crypto.randomUUID();
  await DB.prepare('INSERT OR IGNORE INTO salts (day,salt) VALUES (?,?)').bind(day, salt).run();
  r = await DB.prepare('SELECT salt FROM salts WHERE day=?').bind(day).first();
  return r.salt;
}

function classify(u, ref) {
  const s = ((u.s || '') + ' ' + (u.m || '')).toLowerCase(), r = (ref || '').toLowerCase();
  if (/whatsapp/.test(s) || /whatsapp|wa\.me/.test(r)) return 'whatsapp';
  if (/linkedin/.test(s) || /linkedin|lnkd\.in/.test(r)) return 'linkedin';
  if (/e-?mail|newsletter/.test(s) || /mail\.|outlook|gmail/.test(r)) return 'email';
  if (/google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave/.test(r) || /cpc|organic|search/.test(s)) return 'search';
  if (!u.s && !r) return 'direct';
  return 'other';
}
const device = (ua) => (/ipad|tablet|(android(?!.*mobile))/i.test(ua) ? 'tablet' : /mobi|iphone|android/i.test(ua) ? 'mobile' : 'desktop');
const browser = (ua) => (/edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /samsungbrowser/i.test(ua) ? 'Samsung' : /firefox|fxios/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Other');
const os = (ua) => (/windows/i.test(ua) ? 'Windows' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Other');

// Roll raw events older than 13 months into daily_agg, then delete them. Drop old salts and stale lockouts.
export async function housekeeping(DB, now) {
  const cut = new Date(now); cut.setUTCMonth(cut.getUTCMonth() - 13);
  const cutDay = cut.toISOString().slice(0, 10);
  await DB.batch([
    DB.prepare(`INSERT OR REPLACE INTO daily_agg (day,path,source,country,device,pageviews,visitors,sessions)
      SELECT day,path,IFNULL(source,''),IFNULL(country,''),IFNULL(device,''),SUM(type='pageview'),COUNT(DISTINCT vkey),COUNT(DISTINCT sid)
      FROM events WHERE day < ? GROUP BY day,path,IFNULL(source,''),IFNULL(country,''),IFNULL(device,'')`).bind(cutDay),
    DB.prepare('DELETE FROM events WHERE day < ?').bind(cutDay),
    DB.prepare('DELETE FROM salts WHERE day < ?').bind(new Date(now - 86400000).toISOString().slice(0, 10)),
    DB.prepare('DELETE FROM login_attempts WHERE updated < ?').bind(now - 86400000)
  ]);
}
