/**
 * Emergência: remove o 2FA de uma conta (ex.: administrador técnico que perdeu o aparelho e os códigos).
 * Exige acesso ao banco. Registra na auditoria e encerra as sessões da conta.
 *   npm run reset-2fa -- email@exemplo.org "motivo (mín. 10 caracteres)"
 */
import "@/setup/load-env";
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "@/shared/database/client";
import { sessions, userTotp, users } from "@/shared/database/schema";
import { clearRecoveryCodes } from "@/core/auth/recovery";
import { appendAudit } from "@/access-control/audit/store";

const [email, reason] = process.argv.slice(2);
if (!email || !reason || reason.trim().length < 10) { console.error('uso: npm run reset-2fa -- email@exemplo.org "motivo com pelo menos 10 caracteres"'); process.exit(1); }
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL ausente"); process.exit(1); }
const db = createDb(url);
const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
if (!u || u.deletedAt) { console.error("conta não encontrada"); process.exit(1); }
await db.transaction(async (t) => {
  const tx = t as unknown as typeof db;
  await tx.delete(userTotp).where(eq(userTotp.userId, u.id));
  await clearRecoveryCodes(tx, u.id);
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt)));
  await appendAudit(tx, { actorId: u.id, action: "auth.2fa_reset", subjectId: u.id, payload: { via: "cli", reason } });
});
console.log(`2FA removido para ${email}. No próximo acesso, cadastre um novo aplicativo em Configurações.`);
process.exit(0);
