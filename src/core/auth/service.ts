import { and, eq, gt, isNull, lt, ne } from "drizzle-orm";
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

export interface SessionInfo { sessionId: string; userId: string; mfaVerified: boolean }

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
  const [u] = await db.select({ d: users.deletedAt }).from(users).where(eq(users.id, s.userId));
  if (!u || u.d) return null;
  await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, s.id));
  return { sessionId: s.id, userId: s.userId, mfaVerified: s.mfaVerified };
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
  const step = verifyTotp(decrypt(t.secretEnc), code, now.getTime());
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

export async function issueEmailToken(db: Db, userId: string, kind: "verify" | "reset", now = new Date()) {
  const token = randomToken();
  await db.insert(emailTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + (kind === "verify" ? DAY : 60 * MIN)) });
  return token;
}

async function consumeToken(db: Db, token: string, kind: "verify" | "reset", now: Date) {
  const [row] = await db.update(emailTokens).set({ usedAt: now })
    .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)))
    .returning();
  if (!row) throw new Invalid("link inválido ou expirado");
  return row.userId;
}

export async function verifyEmail(db: Db, token: string, now = new Date()) {
  const id = await consumeToken(db, token, "verify", now);
  await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, id));
}

/** Não revela se o e-mail existe: devolve o token (para envio) ou null. */
export async function requestPasswordReset(db: Db, email: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u && !u.deletedAt ? issueEmailToken(db, u.id, "reset", now) : null;
}

export async function resetPassword(db: Db, token: string, newPassword: string, now = new Date()) {
  const id = await consumeToken(db, token, "reset", now);
  const [u] = await db.select().from(users).where(eq(users.id, id));
  assertPasswordPolicy(newPassword, u.email, u.username);
  await db.update(users).set({ passwordHash: await hashPassword(newPassword), failedAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
  await revokeAllSessions(db, id, undefined, now);
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
