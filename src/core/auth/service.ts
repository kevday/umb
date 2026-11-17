import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { emailTokens, sessions, userTotp, users } from "@/shared/database/schema";
import { brand } from "@/config/brand";
import { appendAudit } from "@/access-control/audit/store";
import { Invalid } from "../errors";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto";
import { assertPasswordPolicy, dummyHash, hashPassword, verifyPassword } from "./password";
import { generateSecret, otpauthUri, stepOf, verifyTotp } from "./totp";
import { RECOVERY_RE, clearRecoveryCodes, consumeRecoveryCode, generateRecoveryCodes, normalizeRecovery } from "./recovery";
import { throttle } from "./throttle";

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
    await db.update(users).set({
      failedAttempts: sql`${users.failedAttempts} + 1`,
      lockedUntil: sql`case when ${users.failedAttempts} + 1 >= ${MAX_FAILS} then ${new Date(now.getTime() + LOCK_MS)} else ${users.lockedUntil} end`,
    }).where(eq(users.id, u.id));
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
  // Uma única ida ao banco resolve sessão, conta e estado do TOTP.
  const [s] = await db.select({
    id: sessions.id,
    userId: sessions.userId,
    mfaVerified: sessions.mfaVerified,
    revokedAt: sessions.revokedAt,
    expiresAt: sessions.expiresAt,
    lastUsedAt: sessions.lastUsedAt,
    userDeletedAt: users.deletedAt,
    mfaConfirmedAt: userTotp.confirmedAt,
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userTotp, eq(userTotp.userId, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  if (!s || s.revokedAt || s.userDeletedAt || s.expiresAt <= now || s.lastUsedAt.getTime() + SESSION_IDLE <= now.getTime()) return null;

  // Reduz escritas repetitivas; no máximo uma atualização de atividade por minuto.
  // O UPDATE condicional impede atualizar uma sessão revogada após a leitura inicial.
  const touchBefore = new Date(now.getTime() - 60_000);
  if (s.lastUsedAt < touchBefore) {
    await db.update(sessions).set({ lastUsedAt: now }).where(and(
      eq(sessions.id, s.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), lt(sessions.lastUsedAt, touchBefore),
    ));
  }
  return { sessionId: s.id, userId: s.userId, mfaVerified: s.mfaVerified, mfaRequired: !!s.mfaConfirmedAt };
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

/** Ativa o 2FA e devolve os códigos de recuperação (mostrados uma única vez). */
export async function confirmTotp(db: Db, userId: string, code: string, now = new Date()): Promise<string[]> {
  await throttle(db, `mfa:${userId}`, 10, 10 * MIN, now);
  await checkCode(db, userId, code, now, false);
  await db.update(userTotp).set({ confirmedAt: now }).where(and(eq(userTotp.userId, userId), isNull(userTotp.confirmedAt)));
  // A ativação/reinscrição invalida a confiança MFA concedida por um autenticador anterior.
  // A ação que conclui o cadastro marca novamente apenas a sessão atual como verificada.
  await db.update(sessions).set({ mfaVerified: false }).where(eq(sessions.userId, userId));
  return generateRecoveryCodes(db, userId);
}

export async function verifyMfa(db: Db, token: string, code: string, now = new Date()) {
  const s = await validateSession(db, token, now);
  if (!s) throw new Invalid("sessão inválida");
  await throttle(db, `mfa:${s.userId}`, 10, 10 * MIN, now); // 10 tentativas a cada 10 minutos
  if (RECOVERY_RE.test(normalizeRecovery(code))) {
    if (!(await consumeRecoveryCode(db, s.userId, code, now))) throw new Invalid("código inválido");
  } else await checkCode(db, s.userId, code, now, true);
  await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, s.sessionId));
}

/** Troca de aplicativo autenticador: exige a senha e um código válido do aparelho atual (ou de recuperação). */
export async function replaceTotp(db: Db, s: SessionInfo, password: string, code: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!(await verifyPassword(u.passwordHash, password))) throw new Invalid("senha incorreta");
  await throttle(db, `mfa:${s.userId}`, 10, 10 * MIN, now);
  if (RECOVERY_RE.test(normalizeRecovery(code))) { if (!(await consumeRecoveryCode(db, s.userId, code, now))) throw new Invalid("código inválido"); }
  else await checkCode(db, s.userId, code, now, true);
  await db.delete(userTotp).where(eq(userTotp.userId, s.userId));
  await clearRecoveryCodes(db, s.userId);
  await revokeAllSessions(db, s.userId, s.sessionId, now);
}

/** Novos códigos de recuperação (os anteriores deixam de valer). Exige a senha. */
export async function regenerateRecoveryCodes(db: Db, userId: string, password: string): Promise<string[]> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!(await verifyPassword(u.passwordHash, password))) throw new Invalid("senha incorreta");
  if (!(await hasMfa(db, userId))) throw new Invalid("ative o 2FA primeiro");
  return generateRecoveryCodes(db, userId);
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

async function consumeToken(db: Db, token: string, kind: "verify" | "reset" | "email_change" | "mfa_reset", now: Date) {
  const [row] = await db.update(emailTokens).set({ usedAt: now })
    .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)))
    .returning();
  if (!row) throw new Invalid("link inválido ou expirado");
  return row;
}

export async function verifyEmail(db: Db, token: string, now = new Date()) {
  const { userId: id } = await consumeToken(db, token, "verify", now);
  await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, id));
}

/** Não revela se o e-mail existe: devolve o token (para envio) ou null. */
export async function requestPasswordReset(db: Db, email: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u && !u.deletedAt ? issueEmailToken(db, u.id, "reset", now) : null;
}

/** Reenvio não enumerável: só emite token para conta existente ainda não verificada. */
export async function requestEmailVerification(db: Db, email: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u && !u.deletedAt && !u.emailVerifiedAt ? issueEmailToken(db, u.id, "verify", now) : null;
}

/** Inicia recuperação do autenticador após senha correta e sessão pendente de MFA. */
export async function requestMfaReset(db: Db, sessionToken: string, now = new Date()) {
  const session = await validateSession(db, sessionToken, now);
  if (!session || !session.mfaRequired || session.mfaVerified)
    throw new Invalid("sessão de recuperação inválida");
  await throttle(db, `mfa-reset:${session.userId}`, 2, 60 * MIN, now);
  const [u] = await db.select({ id: users.id, email: users.email, verified: users.emailVerifiedAt })
    .from(users).where(eq(users.id, session.userId));
  if (!u || !u.verified) throw new Invalid("a conta precisa ter um e-mail verificado para recuperar o autenticador");

  const token = randomToken();
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.execute(sql`select id from users where id = ${u.id} for update`);
    await tx.update(emailTokens).set({ usedAt: now }).where(and(
      eq(emailTokens.userId, u.id), eq(emailTokens.kind, "mfa_reset"), isNull(emailTokens.usedAt),
    ));
    await tx.insert(emailTokens).values({
      userId: u.id, kind: "mfa_reset", tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + 15 * MIN),
    });
  });
  return { token, email: u.email };
}

/** Consome o link e remove TOTP, códigos e sessões na mesma transação. */
export async function confirmMfaReset(db: Db, token: string, now = new Date()) {
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await consumeToken(tx, token, "mfa_reset", now);
    await tx.delete(userTotp).where(eq(userTotp.userId, row.userId));
    await clearRecoveryCodes(tx, row.userId);
    await revokeAllSessions(tx, row.userId, undefined, now);
    await appendAudit(tx, {
      actorId: row.userId, action: "account.mfa_reset", subjectId: row.userId,
      payload: { method: "verified_email_link" },
    }, now);
  });
}

export async function resetPassword(db: Db, token: string, newPassword: string, now = new Date()) {
  const tokenHash = sha256(token);
  const [candidate] = await db.select({ userId: emailTokens.userId }).from(emailTokens).where(and(
    eq(emailTokens.tokenHash, tokenHash), eq(emailTokens.kind, "reset"), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now),
  ));
  if (!candidate) throw new Invalid("link inválido ou expirado");
  const [u] = await db.select().from(users).where(eq(users.id, candidate.userId));
  if (!u || u.deletedAt) throw new Invalid("link inválido ou expirado");
  assertPasswordPolicy(newPassword, u.email, u.username);
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await consumeToken(tx, token, "reset", now);
    if (row.userId !== candidate.userId) throw new Invalid("link inválido ou expirado");
    await tx.update(users).set({ passwordHash, failedAttempts: 0, lockedUntil: null }).where(eq(users.id, row.userId));
    await revokeAllSessions(tx, row.userId, undefined, now);
  });
}

export async function changePassword(db: Db, s: SessionInfo, current: string, next: string, now = new Date()) {
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!(await verifyPassword(u.passwordHash, current))) throw new Invalid("senha atual incorreta");
  assertPasswordPolicy(next, u.email, u.username);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, u.id));
  await revokeAllSessions(db, u.id, s.sessionId, now);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Troca de e-mail pelo próprio usuário: confirma a senha e manda um link para o NOVO endereço (prova de posse). */
export async function requestEmailChange(db: Db, s: SessionInfo, password: string, newEmail: string, now = new Date()) {
  const email = newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new Invalid("e-mail inválido");
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!(await verifyPassword(u.passwordHash, password))) throw new Invalid("senha incorreta");
  if (email === u.email) throw new Invalid("este já é o seu e-mail");
  await throttle(db, `emailchange:${s.userId}`, 5, 60 * MIN, now);
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken) throw new Invalid("este e-mail já está em uso por outra conta");
  const token = randomToken();
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.execute(sql`select id from users where id = ${s.userId} for update`);
    await tx.update(emailTokens).set({ usedAt: now }).where(and(
      eq(emailTokens.userId, s.userId), eq(emailTokens.kind, "email_change"), isNull(emailTokens.usedAt),
    ));
    await tx.insert(emailTokens).values({ userId: s.userId, kind: "email_change", tokenHash: sha256(token), newEmail: email, expiresAt: new Date(now.getTime() + 60 * MIN) });
  });
  return { token, newEmail: email, oldEmail: u.email };
}

/** Efetiva a troca ao abrir o link enviado ao novo endereço. Encerra todas as sessões. */
export async function confirmEmailChange(db: Db, token: string, now = new Date()) {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await consumeToken(tx, token, "email_change", now);
    if (!row.newEmail) throw new Invalid("link inválido ou expirado");
    const [old] = await tx.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
    if (!old) throw new Invalid("link inválido ou expirado");
    try {
      await tx.update(users).set({ email: row.newEmail, emailVerifiedAt: now }).where(eq(users.id, row.userId));
    } catch (e) {
      if (/duplicate key|unique/i.test(`${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ""}`)) throw new Invalid("este e-mail já está em uso por outra conta");
      throw e;
    }
    await tx.update(emailTokens).set({ usedAt: now }).where(and(eq(emailTokens.userId, row.userId), isNull(emailTokens.usedAt)));
    await revokeAllSessions(tx, row.userId, undefined, now);
    return { oldEmail: old.email, newEmail: row.newEmail };
  });
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
