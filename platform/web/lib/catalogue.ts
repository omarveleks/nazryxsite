// Product lines from a CSV or text catalogue: the name-like column of a table (with strength and form columns when
// there are any), or one product per line. The worker does the same for Excel and Word (ingest/catalogue.py).
const NAME_HEADERS = ['generic', 'inn', 'molecule', 'active', 'product', 'name', 'description', 'item'];

function splitRow(line: string, sep: string) {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function catalogueLines(text: string): string[] {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!raw.length) return [];
  const sep = ['\t', ';', ','].find((s) => raw.slice(0, 5).every((l) => l.includes(s)));
  if (!sep) return raw.map((l) => l.trim().slice(0, 200)).filter((l) => /[A-Za-z]{3}/.test(l));
  const rows = raw.map((l) => splitRow(l, sep));
  // the header row: within the first rows, the one naming a product or generic-name column (titles above it are skipped)
  let at = -1, nameCol = -1;
  for (let k = 0; k < Math.min(rows.length, 10) && at < 0; k++) {
    if (rows[k].filter(Boolean).length < 2) continue;   // a title line, not the header
    for (const key of NAME_HEADERS) {
      const i = rows[k].findIndex((h) => h.length < 40 && h.toLowerCase().includes(key));
      if (i >= 0) { at = k; nameCol = i; break; }
    }
  }
  const header = at >= 0 ? rows[at].map((h) => h.toLowerCase()) : [];
  const body = at >= 0 ? rows.slice(at + 1) : rows;
  if (nameCol < 0) nameCol = 0;
  const extra = header.map((h, i) => (i !== nameCol && /strength|dose|form|presentation/.test(h) ? i : -1)).filter((i) => i >= 0);
  return body.map((r) => [r[nameCol], ...extra.map((i) => r[i])].filter(Boolean).join(' ').slice(0, 200))
    .filter((l) => /[A-Za-z]{3}/.test(l));
}
