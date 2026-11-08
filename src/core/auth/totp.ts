import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function b32encode(buf: Buffer): string {
  let bits = 0, v = 0, o = "";
  for (const b of buf) {
    v = (v << 8) | b; bits += 8;
    while (bits >= 5) { o += A[(v >>> (bits - 5)) & 31]; bits -= 5; }
    v &= (1 << bits) - 1;
  }
  if (bits > 0) o += A[(v << (5 - bits)) & 31];
  return o;
}

export function b32decode(s: string): Buffer {
  let bits = 0, v = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error("base32 inválido");
    v = (v << 5) | i; bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; }
    v &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(c).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (nowMs: number, period = 30) => Math.floor(nowMs / 1000 / period);
export const generateSecret = () => b32encode(randomBytes(20));
export const totpAt = (secretB32: string, nowMs: number) => hotp(b32decode(secretB32), stepOf(nowMs));

/** Retorna o passo que casou (janela ±1) ou null. */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = b32decode(secretB32), step = stepOf(nowMs);
  let found: number | null = null;
  for (let d = -window; d <= window; d++) {
    const exp = Buffer.from(hotp(secret, step + d)), got = Buffer.from(code);
    if (timingSafeEqual(exp, got) && found === null) found = step + d;
  }
  return found;
}

export const otpauthUri = (issuer: string, account: string, secretB32: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
