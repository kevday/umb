import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { people } from "../helpers/people";
import { ctx } from "../helpers/world";
import * as inst from "@/access-control/services/institution";
import { can } from "@/access-control/engine/can";
import { loadSubject } from "@/access-control/subject";
import type { Rule } from "@/contracts/access-control";
import { users } from "@/shared/database/schema";

/** O RLS (SQL) e o ACE (TypeScript) devem decidir sempre igual. */
describe("paridade ACE (TS) × RLS (SQL)", () => {
  it("mesma decisão para todos os sujeitos e regras", async () => {
    const { db, f, A, B, r1, c1, m1, o2, l2, member } = await people();
    const sec = await member({ name: "secretaria", degree: 3 });
    await inst.appointOffice(db, B, { userId: sec, name: "Secretário", lodgeId: f.lodgeId, startsAt: new Date("2026-01-01") });
    const velho = await member({ name: "exsecretario", degree: 3 });
    await inst.appointOffice(db, B, { userId: velho, name: "Secretário", lodgeId: f.lodgeId, startsAt: new Date("2025-01-01"), endsAt: new Date("2025-06-01") });
    const susp = await member({ name: "suspenso", degree: 3 });
    await inst.setMemberStatus(db, B, susp, "suspenso", "pendência disciplinar");
    const deb = await member({ name: "emdebito", degree: 2 });
    await inst.setMemberStatus(db, B, deb, "debito", "mensalidades em atraso");
    const [tech] = await db.insert(users).values({ email: "t@t.org", username: "tecnico", passwordHash: "x", isTechnicalAdmin: true }).returning();
    const [ghost] = await db.insert(users).values({ email: "g@t.org", username: "fantasma", passwordHash: "x" }).returning();

    const L1 = f.lodgeId, J = f.jurisdictionId;
    const rules: Rule[] = [
      { kind: "minDegree", value: 1 }, { kind: "minDegree", value: 2 }, { kind: "minDegree", value: 3 },
      { kind: "lodge", id: L1 }, { kind: "lodge", id: l2.id }, { kind: "jurisdiction", id: J }, { kind: "body", id: "qualquer" },
      { kind: "status", allowed: ["regular"] }, { kind: "status", allowed: ["debito", "regular"] },
      { kind: "office", names: ["Venerável Mestre"] }, { kind: "office", names: ["Secretário"], lodgeId: L1 },
      { kind: "office", names: ["Administração da Potência"], jurisdictionId: J }, { kind: "office", names: ["Secretário", "Orador"] },
      { kind: "all", rules: [{ kind: "minDegree", value: 3 }, { kind: "lodge", id: L1 }] },
      { kind: "any", rules: [{ kind: "minDegree", value: 3 }, { kind: "office", names: ["Secretário"] }] },
      { kind: "all", rules: [{ kind: "any", rules: [{ kind: "lodge", id: l2.id }, { kind: "office", names: ["Venerável Mestre"] }] }, { kind: "status", allowed: ["regular"] }] },
      { kind: "all", rules: [] }, { kind: "any", rules: [] },
    ];
    const subjects = [A.userId, B.userId, r1, c1, m1, o2, sec, velho, susp, deb, tech.id, ghost.id];
    let n = 0;
    for (const uid of subjects) {
      const s = await loadSubject(db, uid);
      for (const rule of rules) {
        const ts = s ? can(s, "r", { id: "x", policy: rule }).allow : false;
        const r = (await db.execute(sql`select app_can(${uid}::uuid, ${JSON.stringify(rule)}::jsonb) as ok`)) as unknown as { rows: { ok: boolean }[] };
        expect(r.rows[0].ok, `${uid} × ${JSON.stringify(rule)}`).toBe(ts);
        n++;
      }
    }
    expect(n).toBe(subjects.length * rules.length);
  });
});
