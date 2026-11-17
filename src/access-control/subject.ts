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

  // Uma consulta agregada evita duas viagens sequenciais ao banco (o pool serverless usa max: 1).
  const result = await db.execute(sql`
    SELECT
      COALESCE((
        SELECT MAX(degree)::int FROM degree_assignments
        WHERE user_id = ${userId} AND lodge_id = ${m.lodgeId}
      ), 0)::int AS degree,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', o.name,
          'lodgeId', o.lodge_id,
          'jurisdictionId', o.jurisdiction_id,
          'startsAt', o.starts_at,
          'endsAt', o.ends_at
        ) ORDER BY o.starts_at)
        FROM office_assignments o
        WHERE o.user_id = ${userId}
          AND o.starts_at <= ${now}
          AND (o.ends_at IS NULL OR o.ends_at > ${now})
          AND (o.lodge_id = ${m.lodgeId} OR o.jurisdiction_id = ${m.jurisdictionId})
      ), '[]'::jsonb) AS offices
  `);
  type OfficeRow = { name: string; lodgeId: string | null; jurisdictionId: string | null; startsAt: string | Date; endsAt: string | Date | null };
  const [context] = (result as unknown as { rows: { degree: number; offices: OfficeRow[] }[] }).rows;
  const offs = context.offices;

  return {
    id: u.id,
    status: m.status,
    degree: Number(context.degree),
    lodgeId: m.lodgeId,
    jurisdictionId: m.jurisdictionId,
    bodyIds: [],
    offices: offs.map((o) => ({
      name: o.name,
      lodgeId: o.lodgeId ?? undefined,
      jurisdictionId: o.jurisdictionId ?? undefined,
      startsAt: new Date(o.startsAt),
      endsAt: o.endsAt ? new Date(o.endsAt) : undefined,
    })),
  };
}
