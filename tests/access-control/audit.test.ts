import { describe, expect, it } from "vitest";
import { append, verify, type AuditEntry } from "@/access-control/audit/chain";

describe("auditoria encadeada", () => {
  const log = append(append([], { actorId: "a", action: "degree.request", payload: { z: 1, a: 2 } }), { actorId: "b", action: "degree.approve" });
  it("é íntegra", () => expect(verify(log).ok).toBe(true));
  it("detecta adulteração", () => {
    const bad: AuditEntry[] = log.map((e, i) => (i === 0 ? { ...e, action: "outra" } : e));
    expect(verify(bad)).toEqual({ ok: false, brokenAt: 1 });
  });
});
