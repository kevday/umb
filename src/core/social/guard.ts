import type { Db } from "@/shared/database/client";
import { can } from "@/access-control/engine/can";
import { loadSubject } from "@/access-control/subject";
import { Forbidden } from "../errors";

/** Só membro ativo e validado (Grau ≥ 1, sem status bloqueado) usa a rede social. */
export async function requireMember(db: Db, userId: string, now = new Date()) {
  const s = await loadSubject(db, userId, now);
  if (!s || !can(s, "social", { id: "social", policy: { kind: "minDegree", value: 1 } }, now).allow) throw new Forbidden("acesso restrito a membros ativos");
  return s;
}

export const isRls = (e: unknown) => /row-level security|permission denied/i.test(`${(e as Error)?.message} ${(e as { cause?: Error })?.cause?.message ?? ""}`);
export const isFk = (e: unknown) => /foreign key/i.test(`${(e as Error)?.message} ${(e as { cause?: Error })?.cause?.message ?? ""}`);
