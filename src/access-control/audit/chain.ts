import { createHash } from "node:crypto";

export interface AuditEntry {
  seq: number;
  at: string;
  actorId: string;
  action: string;
  subjectId: string | null;
  payload: unknown;
  prevHash: string;
  hash: string;
}

/** JSON canônico (chaves ordenadas): jsonb do Postgres não preserva a ordem das chaves. */
export function canon(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export const digest = (e: Omit<AuditEntry, "hash">) =>
  createHash("sha256")
    .update(canon([e.seq, e.at, e.actorId, e.action, e.subjectId ?? null, e.payload ?? null, e.prevHash]))
    .digest("hex");

export function append(
  log: readonly AuditEntry[],
  input: { actorId: string; action: string; subjectId?: string | null; payload?: unknown },
  at = new Date(),
): AuditEntry[] {
  const prevHash = log.length ? log[log.length - 1].hash : "0";
  const base = {
    seq: log.length + 1,
    at: at.toISOString(),
    actorId: input.actorId,
    action: input.action,
    subjectId: input.subjectId ?? null,
    payload: input.payload ?? null,
    prevHash,
  };
  return [...log, { ...base, hash: digest(base) }];
}

export function verify(log: readonly AuditEntry[]): { ok: boolean; brokenAt?: number } {
  for (let i = 0; i < log.length; i++) {
    const { hash, ...rest } = log[i];
    if (rest.prevHash !== (i ? log[i - 1].hash : "0") || digest(rest) !== hash) return { ok: false, brokenAt: log[i].seq };
  }
  return { ok: true };
}
