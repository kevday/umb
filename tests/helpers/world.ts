import { verifyEmail } from "@/core/auth/service";
import {
  approveInvitation, bootstrapFounders, createInvitation, registerWithInvitation, type Ctx,
} from "@/access-control/services/institution";
import { degreeAssignments } from "@/shared/database/schema";
import { testDb } from "./db";

export const PW = "senha-de-teste-forte-1";
export const ctx = (userId: string, mfaVerified = true): Ctx => ({ userId, mfaVerified });

/** Jurisdição + Loja 1 com a Potência (A) e o Venerável (B). */
export async function world() {
  const db = await testDb();
  const f = await bootstrapFounders(db, {
    jurisdictionName: "Potência Teste", lodgeName: "Loja Exemplo", lodgeNumber: 1,
    authority: { email: "potencia@teste.org", username: "potencia", fullName: "Autoridade da Potência", password: PW },
    venerable: { email: "vm@teste.org", username: "vm1", fullName: "Venerável Um", password: PW },
    evidence: "Ofício nº 1/2026 da Potência",
  });
  const A = ctx(f.authorityId), B = ctx(f.venerableId);
  async function member(o: { name: string; degree: number; lodgeId?: string; inviter?: Ctx; approver?: Ctx }) {
    const lodgeId = o.lodgeId ?? f.lodgeId;
    const email = `${o.name}@teste.org`;
    const inviter = o.inviter ?? B, approver = o.approver ?? A;
    const inv = await createInvitation(db, inviter, { lodgeId, email, intendedDegree: 1 });
    await approveInvitation(db, approver, inv.invitationId);
    const r = await registerWithInvitation(db, { token: inv.token, email, username: o.name, fullName: o.name, password: PW });
    await verifyEmail(db, r.verifyToken);
    // Graus acima do inicial são dados de cenário de teste; produção usa requestDegree/decideDegree.
    for (let degree = 2; degree <= o.degree; degree++) {
      await db.insert(degreeAssignments).values({
        userId: r.userId, degree, requestedBy: inviter.userId, approvedBy: approver.userId,
      });
    }
    return r.userId;
  }
  return { db, f, A, B, member };
}
