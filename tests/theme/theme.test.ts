import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { people } from "../helpers/people";
import { buildTheme, contrast, themeCss, type Theme } from "@/theme/palette";
import { DEFAULT_THEME, RITES, themeForRite } from "@/theme/rites";
import { resolveTheme, setThemeColor } from "@/theme/service";
import { setLodgeRite } from "@/access-control/services/institution";
import { verifyAuditChain } from "@/access-control/audit/store";
import { Forbidden, Invalid } from "@/core/errors";
import { lodges, profiles } from "@/shared/database/schema";

/** Regras de legibilidade (WCAG AA): texto 7:1 no corpo, secundário 4,5:1, links e botões 4,5:1. */
function legible(t: Theme, label: string) {
  for (const [mode, v] of [["claro", t.light], ["escuro", t.dark]] as const) {
    const w = `${label} (${mode})`;
    expect(contrast(v.tx, v.bg), `${w}: texto/fundo`).toBeGreaterThanOrEqual(7);
    expect(contrast(v.tx, v.card), `${w}: texto/cartão`).toBeGreaterThanOrEqual(7);
    expect(contrast(v.mut, v.bg), `${w}: secundário/fundo`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.link, v.card), `${w}: link/cartão`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.link, v.bg), `${w}: link/fundo`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.on, v.ac), `${w}: texto do botão`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.brand, v.bg), `${w}: marca/fundo`).toBeGreaterThanOrEqual(4.5);
  }
}

describe("paletas", () => {
  it("contraste conhecido", () => expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0));
  it("padrão e todos os Ritos são legíveis nos dois modos", () => {
    legible(DEFAULT_THEME, "padrão");
    for (const r of RITES) legible(themeForRite(r.id), r.name);
  });
  it("qualquer cor escolhida (inclusive branco, preto e cinza) vira um tema legível", () => {
    for (const c of ["#ffffff", "#000000", "#808080", "#ffff00", "#00ff00", "#87cefa", "#002366", "#ff00ff"]) legible(buildTheme(c), c);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 300; i++) { const c = "#" + Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join(""); legible(buildTheme(c), c); }
  });
  it("a cor da orla do Rito é preservada como decoração", () => {
    expect(themeForRite("reaa").decor).toBe("#b22222");
    expect(themeForRite("brasileiro").decor2).toBe("#d4af37");
    expect(themeForRite("brasileiro").decor).toBe("#002366");
  });
  it("o CSS gerado só tem variáveis e hexadecimais", () => {
    for (const t of [DEFAULT_THEME, ...RITES.map((r) => themeForRite(r.id))]) expect(themeCss(t)).toMatch(/^:root\{(--[a-z0-9]+:#[0-9a-f]{6};?)+\}@media \(prefers-color-scheme:dark\)\{:root\{(--[a-z0-9]+:#[0-9a-f]{6};?)+\}\}$/);
    expect(() => buildTheme("red; background:url(x)")).toThrow();
  });
});

describe("escolha da paleta", () => {
  it("segue: padrão → Rito da Loja → cor própria → volta ao Rito", async () => {
    const { db, f, A, B, r1, m1 } = await people();
    expect((await resolveTheme(db, r1)).source).toBe("padrao");
    await setLodgeRite(db, B, f.lodgeId, "reaa");
    const rito = await resolveTheme(db, r1);
    expect(rito.source).toBe("rito"); expect(rito.riteId).toBe("reaa"); expect(rito.theme.decor).toBe("#b22222");
    await setThemeColor(db, r1, "#2E8B57");
    const own = await resolveTheme(db, r1);
    expect(own.source).toBe("personal"); expect(own.custom).toBe("#2e8b57");
    expect((await resolveTheme(db, m1)).source).toBe("rito"); // outro irmão continua no Rito
    await setThemeColor(db, r1, null);
    expect((await resolveTheme(db, r1)).source).toBe("rito");
    await setLodgeRite(db, A, f.lodgeId, null); // a Potência também pode
    expect((await resolveTheme(db, r1)).source).toBe("padrao");
  });
  it("só autoridade da Loja define o Rito; tudo é auditado", async () => {
    const { db, f, B, r1, o2, l2 } = await people();
    await expect(setLodgeRite(db, { userId: r1, mfaVerified: true }, f.lodgeId, "rer")).rejects.toThrow(Forbidden);
    await expect(setLodgeRite(db, { userId: o2, mfaVerified: true }, l2.id, "rer")).rejects.toThrow(Forbidden);
    await expect(setLodgeRite(db, B, f.lodgeId, "rito-inventado")).rejects.toThrow(Invalid);
    await setLodgeRite(db, B, f.lodgeId, "rer");
    expect((await db.select().from(lodges).where(eq(lodges.id, f.lodgeId)))[0].rite).toBe("rer");
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
  it("recusa cor inválida e o banco também", async () => {
    const { db, r1 } = await people();
    await expect(setThemeColor(db, r1, "azul")).rejects.toThrow(Invalid);
    await expect(setThemeColor(db, r1, "#12345")).rejects.toThrow(Invalid);
    await expect(db.update(profiles).set({ themeColor: "red; x" }).where(eq(profiles.userId, r1))).rejects.toThrow();
    await expect(db.execute(sql`update lodges set rite = 'xyz'`)).rejects.toThrow();
  });
});
