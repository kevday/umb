import { eq } from "drizzle-orm";
import type { Db } from "@/shared/database/client";
import { siteSettings } from "@/shared/database/schema";
import { Forbidden, Invalid } from "@/core/errors";
import { loadSubject } from "@/access-control/subject";
import { appendAudit } from "@/access-control/audit/store";
import { HEX, type Theme } from "./palette";
import { NOBLE_PRESETS, buildNobleTheme } from "./noble";

export interface PublicLook { preset: string; primary?: string; accent?: string; tagline: string }
export const DEFAULT_TAGLINE = "Acesso reservado a membros convidados";
export const DEFAULT_LOOK: PublicLook = { preset: "azul-dourado", tagline: DEFAULT_TAGLINE };
const KEY = "public_look";

function sanitize(v: unknown): PublicLook | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const tagline = typeof o.tagline === "string" && o.tagline.trim() && o.tagline.length <= 120 && !/[\u0000-\u001f\u007f]/.test(o.tagline) ? o.tagline.trim() : DEFAULT_TAGLINE;
  if (o.preset === "custom") return typeof o.primary === "string" && HEX.test(o.primary) && typeof o.accent === "string" && HEX.test(o.accent) ? { preset: "custom", primary: o.primary, accent: o.accent, tagline } : null;
  return typeof o.preset === "string" && NOBLE_PRESETS.some((p) => p.id === o.preset) ? { preset: o.preset, tagline } : null;
}

/** Lê a aparência das páginas de entrada. Qualquer falha ou valor inválido cai no padrão (a página de login nunca quebra). */
export async function getPublicLook(db: Db): Promise<PublicLook> {
  try {
    const [r] = await db.select().from(siteSettings).where(eq(siteSettings.key, KEY));
    return (r && sanitize(r.value)) || DEFAULT_LOOK;
  } catch { return DEFAULT_LOOK; }
}

export function lookTheme(look: PublicLook): Theme {
  if (look.preset === "custom" && look.primary && look.accent) return buildNobleTheme(look.primary, look.accent);
  const p = NOBLE_PRESETS.find((x) => x.id === look.preset) ?? NOBLE_PRESETS[0];
  return buildNobleTheme(p.primary, p.accent);
}

/** Somente a administração técnica, com sessão que passou pelo 2FA. Nenhum outro usuário, nem autoridade maçônica, altera. */
async function requireTech(db: Db, ctx: { userId: string; mfaVerified: boolean }) {
  const s = await loadSubject(db, ctx.userId);
  if (!s?.technicalAdmin) throw new Forbidden("restrito à administração técnica");
  if (!ctx.mfaVerified) throw new Forbidden("mfa_required");
}

export async function setPublicLook(db: Db, ctx: { userId: string; mfaVerified: boolean }, i: { preset: string; primary?: string; accent?: string; tagline?: string }, now = new Date()) {
  await requireTech(db, ctx);
  const tagline = (i.tagline ?? "").trim() || DEFAULT_TAGLINE;
  if (tagline.length > 120 || /[\u0000-\u001f\u007f]/.test(tagline)) throw new Invalid("frase de boas-vindas: até 120 caracteres, sem caracteres de controle");
  let look: PublicLook;
  if (i.preset === "custom") {
    if (!i.primary || !HEX.test(i.primary) || !i.accent || !HEX.test(i.accent)) throw new Invalid("cores inválidas: use o formato #RRGGBB");
    look = { preset: "custom", primary: i.primary.toLowerCase(), accent: i.accent.toLowerCase(), tagline };
  } else if (NOBLE_PRESETS.some((p) => p.id === i.preset)) look = { preset: i.preset, tagline };
  else throw new Invalid("paleta desconhecida");
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.insert(siteSettings).values({ key: KEY, value: look, updatedBy: ctx.userId, updatedAt: now })
      .onConflictDoUpdate({ target: siteSettings.key, set: { value: look, updatedBy: ctx.userId, updatedAt: now } });
    await appendAudit(tx, { actorId: ctx.userId, action: "site.public_look", payload: look }, now);
  });
}

export async function resetPublicLook(db: Db, ctx: { userId: string; mfaVerified: boolean }, now = new Date()) {
  await requireTech(db, ctx);
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.delete(siteSettings).where(eq(siteSettings.key, KEY));
    await appendAudit(tx, { actorId: ctx.userId, action: "site.public_look.reset", payload: null }, now);
  });
}
