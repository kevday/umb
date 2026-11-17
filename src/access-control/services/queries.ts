import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import {
  degreeAssignments, degreeRequests, institutionalMemberships, invitations, jurisdictions, lodges, officeAssignments, profiles,
} from "@/shared/database/schema";
import { Forbidden } from "@/core/errors";
import { officeActive } from "../engine/can";
import { POTENCIA, VM } from "../degrees/approval";
import { actorOf, SEC, type Ctx } from "./institution";

/** Visão administrativa: só das Lojas em que o ator tem competência (Secretário, Venerável ou Potência). */
export async function institutionOverview(db: Db, ctx: Ctx, now = new Date()) {
  const actor = await actorOf(db, ctx, now);
  const act = actor.offices.filter((o) => officeActive(o, now));
  const direct = act.filter((o) => [VM, SEC].includes(o.name) && o.lodgeId).map((o) => o.lodgeId!);
  const juris = act.filter((o) => o.name === POTENCIA && o.jurisdictionId).map((o) => o.jurisdictionId!);
  if (!direct.length && !juris.length) throw new Forbidden("sem competência administrativa");
  const viaJuris = juris.length ? await db.select({ id: lodges.id }).from(lodges).where(inArray(lodges.jurisdictionId, juris)) : [];
  const ids = [...new Set([...direct, ...viaJuris.map((l) => l.id)])];
  const ls = await db.select().from(lodges).where(inArray(lodges.id, ids));
  const out = [];
  for (const l of ls) {
    const members = await db
      .select({
        userId: institutionalMemberships.userId, name: profiles.fullName, status: institutionalMemberships.status,
        degree: sql<number>`coalesce((select max(d.degree) from degree_assignments d where d.user_id = ${institutionalMemberships.userId} and d.lodge_id = ${l.id}), 0)`,
      })
      .from(institutionalMemberships).innerJoin(profiles, eq(profiles.userId, institutionalMemberships.userId))
      .where(and(eq(institutionalMemberships.lodgeId, l.id), lte(institutionalMemberships.startsAt, now), or(isNull(institutionalMemberships.endsAt), gt(institutionalMemberships.endsAt, now))));
    const invs = await db.select().from(invitations).where(and(eq(invitations.lodgeId, l.id), isNull(invitations.usedAt), gt(invitations.expiresAt, now)));
    const reqs = await db.select().from(degreeRequests).where(and(eq(degreeRequests.lodgeId, l.id), eq(degreeRequests.status, "pendente")));
    const offs = await db
      .select({ id: officeAssignments.id, userId: officeAssignments.userId, name: officeAssignments.name, startsAt: officeAssignments.startsAt, endsAt: officeAssignments.endsAt })
      .from(officeAssignments).where(eq(officeAssignments.lodgeId, l.id));
    const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? id;
    out.push({
      lodge: l,
      members: members.map((m) => ({ ...m, degree: Number(m.degree) })),
      invitations: invs.map((i) => ({ id: i.id, email: i.email, degree: i.intendedDegree, approved: !!i.approvedBy })),
      requests: reqs.map((r) => ({ id: r.id, userId: r.userId, name: nameOf(r.userId), from: r.fromDegree, to: r.toDegree, requestedByName: nameOf(r.requestedBy) })),
      offices: offs.filter((o) => officeActive({ startsAt: o.startsAt, endsAt: o.endsAt ?? undefined }, now)).map((o) => ({ ...o, userName: nameOf(o.userId) })),
    });
  }
  return { jurisdictions: juris.length ? await db.select().from(jurisdictions).where(inArray(jurisdictions.id, juris)) : [], lodges: out };
}

/** Maior Grau de cada pessoa (para exibir no perfil quando a privacidade permitir). */
export async function degreeOf(db: Db, userId: string) {
  const [r] = await db.select({ d: sql<number>`coalesce(max(${degreeAssignments.degree}), 0)` }).from(degreeAssignments).where(eq(degreeAssignments.userId, userId));
  return Number(r.d);
}
