import { asc, desc, sql } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { accessAuditLogs } from "@/shared/database/schema";
import { digest, verify, type AuditEntry } from "./chain";

/** Anexa ao log encadeado. Deve rodar dentro da mesma transação da operação auditada. */
export async function appendAudit(
  tx: Db,
  e: { actorId: string; action: string; subjectId?: string | null; payload?: unknown },
  at = new Date(),
) {
  await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
  const [last] = await tx.select().from(accessAuditLogs).orderBy(desc(accessAuditLogs.seq)).limit(1);
  const base = {
    seq: (last?.seq ?? 0) + 1,
    at: at.toISOString(),
    actorId: e.actorId,
    action: e.action,
    subjectId: e.subjectId ?? null,
    payload: e.payload ?? null,
    prevHash: last?.hash ?? "0",
  };
  await tx.insert(accessAuditLogs).values({ ...base, at, hash: digest(base) });
}

export async function readAudit(db: Db): Promise<AuditEntry[]> {
  const rows = await db.select().from(accessAuditLogs).orderBy(asc(accessAuditLogs.seq));
  return rows.map((r) => ({ seq: r.seq, at: r.at.toISOString(), actorId: r.actorId, action: r.action, subjectId: r.subjectId, payload: r.payload, prevHash: r.prevHash, hash: r.hash }));
}

export async function verifyAuditChain(db: Db) {
  return verify(await readAudit(db));
}
