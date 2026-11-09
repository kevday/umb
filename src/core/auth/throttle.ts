import { sql } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { rateLimits } from "@/shared/database/schema";
import { Invalid } from "../errors";

/** Conta uma tentativa; acima do limite na janela, recusa. Usado em login, cadastro e recuperação de senha. */
export async function throttle(db: Db, key: string, limit: number, windowMs: number, now = new Date()) {
  const iso = now.toISOString();
  const expired = sql`${rateLimits.windowStart} + (${windowMs} * interval '1 millisecond') < ${iso}::timestamptz`;
  const [r] = await db.insert(rateLimits).values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`, windowStart: sql`case when ${expired} then ${iso}::timestamptz else ${rateLimits.windowStart} end` },
    }).returning();
  if (r.count > limit) throw new Invalid("muitas tentativas; aguarde alguns minutos e tente de novo");
}
