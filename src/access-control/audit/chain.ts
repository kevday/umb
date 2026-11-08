import { createHash } from "node:crypto";

export interface AuditEntry {
  seq: number;
  at: string;
  actorId: string;
  action: string;
  subjectId?: string;
  before?: unknown;
  after?: unknown;
  prevHash: string;
  hash: string;
}

const digest = (e: Omit<AuditEntry, "hash">) => createHash("sha256").update(JSON.stringify(e)).digest("hex");

export function append(
  log: readonly AuditEntry[],
  input: Pick<AuditEntry, "actorId" | "action" | "subjectId" | "before" | "after">,
  at = new Date(),
): AuditEntry[] {
  const prevHash = log.length ? log[log.length - 1].hash : "0";
  const base = { seq: log.length + 1, at: at.toISOString(), ...input, prevHash };
  return [...log, { ...base, hash: digest(base) }];
}

export function verify(log: readonly AuditEntry[]): { ok: boolean; brokenAt?: number } {
  for (let i = 0; i < log.length; i++) {
    const { hash, ...rest } = log[i];
    if (rest.prevHash !== (i ? log[i - 1].hash : "0") || digest(rest) !== hash) return { ok: false, brokenAt: log[i].seq };
  }
  return { ok: true };
}
