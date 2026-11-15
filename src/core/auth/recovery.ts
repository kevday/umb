import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { recoveryCodes } from "@/shared/database/schema";
import { sha256 } from "./crypto";

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789"; // sem 0/o/1/l/i
const piece = () => Array.from({ length: 5 }, () => ALPHA[randomInt(ALPHA.length)]).join("");
export const RECOVERY_RE = /^[a-z0-9]{5}-[a-z0-9]{5}$/;
export const normalizeRecovery = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

/** Gera 10 códigos de uso único (substitui os anteriores). Devolve o texto uma única vez; só o hash fica no banco. */
export async function generateRecoveryCodes(db: Db, userId: string, n = 10): Promise<string[]> {
  const codes = Array.from({ length: n }, () => `${piece()}-${piece()}`);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(c) })));
  });
  return codes;
}

/** Consome um código (atômico: dois usos simultâneos não passam). */
export async function consumeRecoveryCode(db: Db, userId: string, input: string, now = new Date()): Promise<boolean> {
  const c = normalizeRecovery(input);
  if (!RECOVERY_RE.test(c)) return false;
  const r = await db.update(recoveryCodes).set({ usedAt: now })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, sha256(c)), isNull(recoveryCodes.usedAt))).returning({ id: recoveryCodes.id });
  return r.length > 0;
}

export async function remainingRecoveryCodes(db: Db, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(recoveryCodes).where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return Number(r.n);
}

export const clearRecoveryCodes = (db: Db, userId: string) => db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
