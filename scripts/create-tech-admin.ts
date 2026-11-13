/** Cria a conta de administração técnica (sem autoridade maçônica). DATABASE_URL, TECH_EMAIL, TECH_USER, TECH_PASSWORD. */
import "@/setup/load-env";
import { createDb } from "@/shared/database/client";
import { assertPasswordPolicy } from "@/core/auth/password";
import { createTechAdmin } from "@/setup/steps";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`variável ${k} ausente`); return v; };
const db = createDb(need("DATABASE_URL"));
const p = { name: "Administrador técnico", email: need("TECH_EMAIL"), username: need("TECH_USER"), password: need("TECH_PASSWORD") };
assertPasswordPolicy(p.password, p.email, p.username);
await createTechAdmin(db, p);
console.log("administrador técnico criado");
process.exit(0);
