/** Cria a conta de administração técnica (sem autoridade maçônica). DATABASE_URL, TECH_EMAIL, TECH_USER, TECH_PASSWORD. */
import { createDb } from "@/shared/database/client";
import { users } from "@/shared/database/schema";
import { hashPassword, assertPasswordPolicy } from "@/core/auth/password";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`variável ${k} ausente`); return v; };
const db = createDb(need("DATABASE_URL"));
assertPasswordPolicy(need("TECH_PASSWORD"), need("TECH_EMAIL"), need("TECH_USER"));
await db.insert(users).values({
  email: need("TECH_EMAIL").toLowerCase(), username: need("TECH_USER"), passwordHash: await hashPassword(need("TECH_PASSWORD")),
  emailVerifiedAt: new Date(), isTechnicalAdmin: true,
});
console.log("administrador técnico criado");
process.exit(0);
