import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { institutionalMemberships, lodges, profiles } from "@/shared/database/schema";
import { Invalid } from "@/core/errors";
import { HEX, buildTheme, themeCss, type Theme } from "./palette";
import { DEFAULT_THEME, findRite, themeForRite } from "./rites";

export interface ResolvedTheme { source: "personal" | "rito" | "padrao"; label: string; riteId?: string; theme: Theme; css: string; custom?: string }

/** Ordem de prioridade: cor própria do irmão, depois o Rito da Loja, depois o padrão. */
export async function resolveTheme(db: Db, userId: string, now = new Date()): Promise<ResolvedTheme> {
  const [p] = await db.select({ c: profiles.themeColor }).from(profiles).where(eq(profiles.userId, userId));
  if (p?.c && HEX.test(p.c)) {
    const theme = buildTheme(p.c);
    return { source: "personal", label: "Cor personalizada", theme, css: themeCss(theme), custom: p.c };
  }
  const [m] = await db.select({ rite: lodges.rite }).from(institutionalMemberships)
    .innerJoin(lodges, eq(lodges.id, institutionalMemberships.lodgeId))
    .where(and(eq(institutionalMemberships.userId, userId), or(isNull(institutionalMemberships.endsAt), gt(institutionalMemberships.endsAt, now)))).limit(1);
  const rite = findRite(m?.rite);
  if (rite) { const theme = themeForRite(rite.id); return { source: "rito", label: rite.name, riteId: rite.id, theme, css: themeCss(theme) }; }
  return { source: "padrao", label: "Padrão", theme: DEFAULT_THEME, css: themeCss(DEFAULT_THEME) };
}


/** Cor própria (#RRGGBB) ou null para voltar ao Rito/padrão. O ajuste de contraste é automático. */
export async function setThemeColor(db: Db, userId: string, color: string | null) {
  if (color !== null && !HEX.test(color)) throw new Invalid("cor inválida: use o formato #RRGGBB");
  await db.update(profiles).set({ themeColor: color ? color.toLowerCase() : null }).where(eq(profiles.userId, userId));
}
