/**
 * Fundação da plataforma: cria a jurisdição, a primeira Loja, a Administração da Potência e o Venerável Mestre.
 * Exige EVIDÊNCIA da indicação pela Potência (verificada fora da plataforma). Senhas só por variável de ambiente.
 *
 *   BOOT_JURISDICTION="..." BOOT_LODGE="..." BOOT_LODGE_NUMBER=1 BOOT_EVIDENCE="Ofício nº ..." \
 *   BOOT_AUTH_EMAIL=... BOOT_AUTH_USER=... BOOT_AUTH_NAME="..." BOOT_AUTH_PASSWORD=... \
 *   BOOT_VM_EMAIL=...   BOOT_VM_USER=...   BOOT_VM_NAME="..."   BOOT_VM_PASSWORD=... npm run bootstrap
 */
import "@/setup/load-env";
import { createDb } from "@/shared/database/client";
import { bootstrapFounders } from "@/access-control/services/institution";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`variável ${k} ausente`);
  return v;
};
const db = createDb(need("DATABASE_URL"));
const r = await bootstrapFounders(db, {
  jurisdictionName: need("BOOT_JURISDICTION"),
  lodgeName: need("BOOT_LODGE"),
  lodgeNumber: Number(process.env.BOOT_LODGE_NUMBER) || undefined,
  evidence: need("BOOT_EVIDENCE"),
  authority: { email: need("BOOT_AUTH_EMAIL"), username: need("BOOT_AUTH_USER"), fullName: need("BOOT_AUTH_NAME"), password: need("BOOT_AUTH_PASSWORD") },
  venerable: { email: need("BOOT_VM_EMAIL"), username: need("BOOT_VM_USER"), fullName: need("BOOT_VM_NAME"), password: need("BOOT_VM_PASSWORD") },
});
console.log("fundação concluída:", r);
process.exit(0);
