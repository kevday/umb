import { cookies } from "next/headers";
import { decrypt, encrypt } from "@/core/auth/crypto";

const prod = process.env.NODE_ENV === "production";

/** Segredo de vida curta (códigos de recuperação, link de convite): cifrado, httpOnly e some em 2 minutos. */
export async function setSecretFlash(name: string, value: string, maxAge = 120) {
  (await cookies()).set(`flash_${name}`, encrypt(value), { httpOnly: true, secure: prod, sameSite: "strict", path: "/", maxAge });
}
export async function readSecretFlash(name: string): Promise<string | null> {
  const v = (await cookies()).get(`flash_${name}`)?.value;
  if (!v) return null;
  try { return decrypt(v); } catch { return null; }
}
export async function clearSecretFlash(name: string) { (await cookies()).delete(`flash_${name}`); }
