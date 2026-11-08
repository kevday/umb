import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

function key(): Buffer {
  const k = process.env.DATA_ENCRYPTION_KEY;
  if (!k) throw new Error("DATA_ENCRYPTION_KEY ausente (32 bytes em base64)");
  const b = Buffer.from(k, "base64");
  if (b.length !== 32) throw new Error("DATA_ENCRYPTION_KEY deve ter 32 bytes");
  return b;
}

/** AES-256-GCM: iv.tag.ciphertext (base64). Usado para segredos em repouso (TOTP). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decrypt(s: string): string {
  const [iv, tag, ct] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
