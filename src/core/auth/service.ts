import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { emailTokens, sessions, userTotp, users } from "@/shared/database/schema";
import { brand } from "@/config/brand";
import { Invalid } from "../errors";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto";
import { assertPasswordPolicy, dummyHash, hashPassword, verifyPassword } from "./password";
import { generateSecret, otpauthUri, stepOf, verifyTotp } from "./totp";

const GENERIC = "credenciais inválidas";
const MIN = 60_000, DAY = 24 * 60 * MIN;
export const SESSION_ABSOLUTE = 30 * DAY, SESSION_IDLE = 7 * DAY;
const MAX_FAILS = 5, LOCK_MS = 15 * MIN;

export interface SessionInfo { sessionId: string; userId: string; mfaVerified: boolean; mfaRequired: boolean }

export async function login(db: Db, i: { email: string; password: string; ip?: string; userAgent?: string }, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.email, i.email.trim().toLowerCase()));
  const ok = await verifyPassword(u?.passwordHash ?? (await dummyHash()), i.password);
  if (!u || u.deletedAt || (u.lockedUntil && u.lockedUntil > now)) throw new Invalid(GENERIC);
  if (!ok) {
    const n = u.failedAttempts + 1;
    await db.update(users).set({ failedAttempts: n, lockedUntil: n >= MAX_FAILS ? new Date(now.getTime() + LOCK_MS) : u.lockedUntil }).where(eq(users.id, u.id));
    throw new Invalid(GENERIC);
  }
  if (!u.emailVerifiedAt) throw new Invalid("e-mail não verificado");
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, u.id));
  const [t] = await db.select().from(userTotp).where(eq(userTotp.userId, u.id));
  const token = randomToken();
  await db.insert(sessions).values({
    userId: u.id, tokenHash: sha256(token), userAgent: i.userAgent, ip: i.ip,
    createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE),
  });
  return { status: t?.confirmedAt ? ("mfa_required" as const) : ("ok" as const), token, userId: u.id };
}

export async function validateSession(db: Db, token: string, now = new Date()): Promise<SessionInfo | null> {
  const [s] = await db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token)));
  if (!s || s.revokedAt || s.expiresAt <= now || s.lastUsedAt.getTime() + SESSION_IDLE <= now.getTime()) return null;
  const [[u], [totp]] = await Promise.all([
    db.select({ d: users.deletedAt }).from(users).where(eq(users.id, s.userId)),
    db.select({ confirmedAt: userTotp.confirmedAt }).from(userTotp).where(eq(userTotp.userId, s.userId)),
  ]);
  if (!u || u.d) return null;
  // Evita uma escrita no PostgreSQL em toda navegação; a janela de inatividade tem tolerância máxima de 60 s.
  const touchBefore = new Date(now.getTime() - 60_000);
  if (s.lastUsedAt < touchBefore) {
    await db.update(sessions).set({ lastUsedAt: now })
      .where(and(eq(sessions.id, s.id), lt(sessions.lastUsedAt, touchBefore)));
  }
  return { sessionId: s.id, userId: s.userId, mfaVerified: s.mfaVerified, mfaRequired: !!totp?.confirmedAt };
}

export async function logout(db: Db, token: string, now = new Date()) {
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.tokenHash, sha256(token)));
}

export async function revokeAllSessions(db: Db, userId: string, exceptSessionId?: string, now = new Date()) {
  await db.update(sessions).set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined));
}

export async function enrollTotp(db: Db, userId: string, account: string) {
  const [t] = await db.select().from(userTotp).where(eq(userTotp.userId, userId));
  if (t?.confirmedAt) throw new Invalid("2FA já ativado");
  const secret = generateSecret();
  await db.insert(userTotp).values({ userId, secretEnc: encrypt(secret) })
    .onConflictDoUpdate({ target: userTotp.userId, set: { secretEnc: encrypt(secret), lastStep: null } });
  return { secret, uri: otpauthUri(brand.name, account, secret) };
}

/**
 * Valida e consome o passo TOTP com UPDATE condicional atômico.
 * Duas requisições concorrentes com o mesmo código não conseguem consumi-lo duas vezes.
 */
async function checkCode(db: Db, userId: string, code: string, now: Date, requireConfirmed: boolean) {
  const [t] = await db.select().from(userTotp).where(eq(userTotp.userId, userId));
  if (!t || (requireConfirmed && !t.confirmedAt)) throw new Invalid("código inválido");
  let secret: string;
  try { secret = decrypt(t.secretEnc); }
  catch { throw new Invalid("não foi possível abrir o segredo do autenticador; a chave de criptografia da instalação precisa ser conferida"); }
  const step = verifyTotp(secret, code, now.getTime());
  if (step === null || (t.lastStep !== null && step <= t.lastStep)) throw new Invalid("código inválido");
  const [consumed] = await db.update(userTotp).set({ lastStep: step })
    .where(and(
      eq(userTotp.userId, userId),
      or(isNull(userTotp.lastStep), lt(userTotp.lastStep, step)),
    ))
    .returning({ userId: userTotp.userId });
  if (!consumed) throw new Invalid("código inválido");
}

export async function confirmTotp(db: Db, userId: string, code: string, now = new Date()) {
  await checkCode(db, userId, code, now, false);
  await db.update(userTotp).set({ confirmedAt: now }).where(and(eq(userTotp.userId, userId), isNull(userTotp.confirmedAt)));
}

export async function verifyMfa(db: Db, token: string, code: string, now = new Date()) {
  const s = await validateSession(db, token, now);
  if (!s) throw new Invalid("sessão inválida");
  await checkCode(db, s.userId, code, now, true);
  await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, s.sessionId));
}

export async function hasMfa(db: Db, userId: string) {
  const [t] = await db.select().from(userTotp).where(eq(userTotp.userId, userId));
  return !!t?.confirmedAt;
}

export async function issueEmailToken(db: Db, userId: string, kind: "verify" | "reset" | "mfa_reset", now = new Date()) {
  const token = randomToken();
  await db.insert(emailTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + (kind === "verify" ? DAY : kind === "mfa_reset" ? 15 * MIN : 60 * MIN)) });
  return token;
}

async function consumeToken(db: Db, token: string, kind: "verify" | "reset" | "change_email" | "mfa_reset", now: Date) {
  const [row] = await db.update(emailTokens).set({ usedAt: now })
    .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)))
    .returning();
  if (!row) throw new Invalid("link inválido ou expirado");
  return row;
}

export async function verifyEmail(db: Db, token: string, now = new Date()) {
  const row = await consumeToken(db, token, "verify", now);
  await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, row.userId));
}

/** Reenvio não enumerável de confirmação: só emite token para conta existente ainda não verificada. */
export async function requestEmailVerification(db: Db, email: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u && !u.deletedAt && !u.emailVerifiedAt ? issueEmailToken(db, u.id, "verify", now) : null;
}

/** Não revela se o e-mail existe: devolve o token (para envio) ou null. */
export async function requestPasswordReset(db: Db, email: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u && !u.deletedAt ? issueEmailToken(db, u.id, "reset", now) : null;
}

export async function resetPassword(db: Db, token: string, newPassword: string, now = new Date()) {
  const row = await consumeToken(db, token, "reset", now);
  const [u] = await db.select().from(users).where(eq(users.id, row.userId));
  assertPasswordPolicy(newPassword, u.email, u.username);
  await db.update(users).set({ passwordHash: await hashPassword(newPassword), failedAttempts: 0, lockedUntil: null }).where(eq(users.id, row.userId));
  await revokeAllSessions(db, row.userId, undefined, now);
}

/** Em recuperação, o usuário já provou a senha no login; exige confirmação adicional no e-mail verificado. */
export async function requestMfaReset(db: Db, sessionToken: string, now = new Date()) {
  const session = await validateSession(db, sessionToken, now);
  if (!session || !session.mfaRequired || session.mfaVerified) throw new Invalid("sessão de recuperação inválida");
  const [u] = await db.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, session.userId));
  if (!u || !u.emailVerifiedAt) throw new Invalid("a conta precisa ter um e-mail verificado para recuperar o autenticador");
  await db.update(emailTokens).set({ usedAt: now }).where(and(eq(emailTokens.userId, u.id), eq(emailTokens.kind, "mfa_reset"), isNull(emailTokens.usedAt)));
  const token = await issueEmailToken(db, u.id, "mfa_reset", now);
  return { token, email: u.email };
}

/** Remove o TOTP somente após uso único do link enviado ao e-mail já verificado; encerra todas as sessões. */
export async function confirmMfaReset(db: Db, token: string, now = new Date()) {
  const row = await consumeToken(db, token, "mfa_reset", now);
  await db.transaction(async (tx) => {
    await tx.delete(userTotp).where(eq(userTotp.userId, row.userId));
    await tx.update(sessions).set({ revokedAt: now })
      .where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
  });
}

/** Solicita alteração de e-mail com senha atual e confirmação enviada ao novo endereço. */
export async function requestEmailChange(db: Db, s: SessionInfo, currentPassword: string, newEmail: string, now = new Date()) {
  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Invalid("endereço de e-mail inválido");
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!u || u.deletedAt || !(await verifyPassword(u.passwordHash, currentPassword))) throw new Invalid("senha atual incorreta");
  if (email === u.email.toLowerCase()) throw new Invalid("informe um endereço diferente do atual");
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken) throw new Invalid("este endereço de e-mail já está associado a uma conta");
  await db.update(emailTokens).set({ usedAt: now }).where(and(eq(emailTokens.userId, u.id), eq(emailTokens.kind, "change_email"), isNull(emailTokens.usedAt)));
  const token = randomToken();
  await db.insert(emailTokens).values({ userId: u.id, kind: "change_email", targetEmail: email, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + 60 * MIN) });
  return { token, email };
}

/** Confirma o novo endereço, marca-o verificado e encerra as demais sessões. */
export async function confirmEmailChange(db: Db, token: string, now = new Date()) {
  const row = await consumeToken(db, token, "change_email", now);
  if (!row.targetEmail) throw new Invalid("solicitação de alteração inválida");
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, row.targetEmail));
  if (taken) throw new Invalid("este endereço de e-mail já está associado a uma conta");
  try {
    await db.update(users).set({ email: row.targetEmail, emailVerifiedAt: now }).where(eq(users.id, row.userId));
  } catch {
    throw new Invalid("não foi possível utilizar este endereço de e-mail");
  }
  await revokeAllSessions(db, row.userId, undefined, now);
}

export async function changePassword(db: Db, s: SessionInfo, current: string, next: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!(await verifyPassword(u.passwordHash, current))) throw new Invalid("senha atual incorreta");
  assertPasswordPolicy(next, u.email, u.username);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, u.id));
  await revokeAllSessions(db, u.id, s.sessionId, now);
}

export { stepOf };

/** Segredo ainda não confirmado (para exibir durante o cadastro do 2FA). */
export async function pendingTotpSecret(db: Db, userId: string): Promise<string | null> {
  const [t] = await db.select().from(userTotp).where(eq(userTotp.userId, userId));
  return t && !t.confirmedAt ? decrypt(t.secretEnc) : null;
}

/** A sessão que acabou de provar o segundo fator passa a valer como 2FA. */
export async function markSessionMfa(db: Db, sessionId: string) {
  await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId));
}
