import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Subject } from "@/contracts/access-control";
import type { Db } from "@/shared/database/client";
import { degreeAssignments, institutionalMemberships, lodges, officeAssignments, users } from "@/shared/database/schema";

/**
 * Carrega o sujeito do ACE somente quando existe exatamente um vínculo institucional
 * vigente. Não escolhe arbitrariamente entre vínculos sobrepostos.
 */
export async function loadSubject(db: Db, userId: string, now = new Date()): Promise<Subject | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.deletedAt) return null;
  if (u.isTechnicalAdmin) return { id: u.id, technicalAdmin: true, status: "regular", degree: 0, bodyIds: [], offices: [] };

  const memberships = await db
    .select({
      lodgeId: institutionalMemberships.lodgeId,
      status: institutionalMemberships.status,
      jurisdictionId: lodges.jurisdictionId,
    })
    .from(institutionalMemberships)
    .innerJoin(lodges, eq(lodges.id, institutionalMemberships.lodgeId))
    .where(and(
      eq(institutionalMemberships.userId, userId),
      lte(institutionalMemberships.startsAt, now),
      or(isNull(institutionalMemberships.endsAt), gt(institutionalMemberships.endsAt, now)),
    ))
    .limit(2);

  // Vínculos sobrepostos são inconsistência institucional: negar acesso até saneamento.
  if (memberships.length !== 1) return null;
  const m = memberships[0];

  const [d] = await db
    .select({ max: sql<number>`coalesce(max(${degreeAssignments.degree}), 0)` })
    .from(degreeAssignments)
    .where(eq(degreeAssignments.userId, userId));

  // Cargo só integra o sujeito se estiver vigente e pertencer à Loja/Jurisdição atual.
  const offs = await db.select().from(officeAssignments).where(and(
    eq(officeAssignments.userId, userId),
    lte(officeAssignments.startsAt, now),
    or(isNull(officeAssignments.endsAt), gt(officeAssignments.endsAt, now)),
    or(
      eq(officeAssignments.lodgeId, m.lodgeId),
      eq(officeAssignments.jurisdictionId, m.jurisdictionId),
    ),
  ));

  return {
    id: u.id,
    status: m.status,
    degree: Number(d.max),
    lodgeId: m.lodgeId,
    jurisdictionId: m.jurisdictionId,
    bodyIds: [],
    offices: offs.map((o) => ({
      name: o.name,
      lodgeId: o.lodgeId ?? undefined,
      jurisdictionId: o.jurisdictionId ?? undefined,
      startsAt: o.startsAt,
      endsAt: o.endsAt ?? undefined,
    })),
  };
}
