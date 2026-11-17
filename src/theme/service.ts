import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { institutionalMemberships, lodges, profiles } from "@/shared/database/schema";
import { Invalid } from "@/core/errors";
import { HEX, buildTheme, themeCss, type Theme } from "./palette";
import { DEFAULT_THEME, findRite, themeForRite } from "./rites";

export interface ResolvedTheme { source: "personal" | "rito" | "padrao"; label: string; riteId?: string; theme: Theme; css: string; custom?: string }

/** Ordem: Rito da Loja; sem Rito, cor pessoal; por último, tema padrão do sistema. */
export async function resolveTheme(db: Db, userId: string, now = new Date()): Promise<ResolvedTheme> {
  const [p] = await db.select({ c: profiles.themeColor }).from(profiles).where(eq(profiles.userId, userId));

  // O Rito institucional sempre prevalece sobre a preferência pessoal.
  const memberships = await db.select({ rite: lodges.rite }).from(institutionalMemberships)
    .innerJoin(lodges, eq(lodges.id, institutionalMemberships.lodgeId))
    .where(and(
      eq(institutionalMemberships.userId, userId),
      lte(institutionalMemberships.startsAt, now),
      or(isNull(institutionalMemberships.endsAt), gt(institutionalMemberships.endsAt, now)),
    ))
    .limit(2);
  const rite = findRite(memberships.length === 1 ? memberships[0].rite : null);
  if (rite) {
    const theme = themeForRite(rite.id);
    return { source: "rito", label: rite.name, riteId: rite.id, theme, css: themeCss(theme), custom: p?.c ?? undefined };
  }

  // A cor pessoal só é aplicada quando não há Rito institucional válido.
  if (p?.c && HEX.test(p.c)) {
    const theme = buildTheme(p.c);
    return { source: "personal", label: "Cor personalizada", theme, css: themeCss(theme), custom: p.c };
  }

  return { source: "padrao", label: "Padrão do sistema", theme: DEFAULT_THEME, css: themeCss(DEFAULT_THEME) };
}


/** Cor própria (#RRGGBB) ou null para voltar ao Rito/padrão. O ajuste de contraste é automático. */
export async function setThemeColor(db: Db, userId: string, color: string | null) {
  if (color !== null && !HEX.test(color)) throw new Invalid("cor inválida: use o formato #RRGGBB");
  await db.update(profiles).set({ themeColor: color ? color.toLowerCase() : null }).where(eq(profiles.userId, userId));
}
