import { hash, verify } from "@node-rs/argon2";
import { Invalid } from "../errors";

// OWASP: Argon2id, m=19 MiB, t=2, p=1
const PARAMS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, PARAMS);
export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try { return await verify(stored, pw); } catch { return false; }
}

export function assertPasswordPolicy(pw: string, ...forbidden: string[]) {
  if (pw.length < 12) throw new Invalid("a senha deve ter ao menos 12 caracteres");
  if (pw.length > 128) throw new Invalid("a senha deve ter no máximo 128 caracteres");
  const low = pw.toLowerCase();
  // ignora trechos curtos (ex.: usuário "a"), que casariam com quase qualquer senha
  if (forbidden.some((f) => f.length >= 4 && low.includes(f.toLowerCase()))) throw new Invalid("a senha não pode conter seu e-mail ou nome de usuário");
}

let dummy: Promise<string> | undefined;
/** Hash descartável: iguala o tempo de resposta quando o e-mail não existe. */
export const dummyHash = () => (dummy ??= hashPassword("senha-descartavel-nunca-usada"));
