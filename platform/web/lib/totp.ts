import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 time-based one-time codes (what authenticator apps show): 30-second steps, 6 digits, SHA-1.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret(): string {
  const bytes = randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error('bad base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function codeAt(secret: string, unixSeconds: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(unixSeconds / 30)));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** Accept the current code and one step either side (clock drift). */
export function verifyCode(secret: string, code: string, now = Date.now() / 1000): boolean {
  const c = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-30, 0, 30].some((d) => {
    const want = Buffer.from(codeAt(secret, now + d));
    return timingSafeEqual(want, Buffer.from(c));
  });
}

export function otpauthUri(secret: string, account: string): string {
  return `otpauth://totp/${encodeURIComponent('Nazryx:' + account)}?secret=${secret}&issuer=Nazryx&algorithm=SHA1&digits=6&period=30`;
}
