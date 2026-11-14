import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { people } from "../helpers/people";
import { contrast, themeCss, type Theme } from "@/theme/palette";
import { NOBLE_PRESETS, buildNobleTheme } from "@/theme/noble";
import { DEFAULT_LOOK, getPublicLook, lookTheme, resetPublicLook, setPublicLook } from "@/theme/site";
import { withUser } from "@/shared/database/rls";
import { verifyAuditChain } from "@/access-control/audit/store";
import { Forbidden, Invalid } from "@/core/errors";
import { siteSettings, users } from "@/shared/database/schema";

function legible(t: Theme, label: string) {
  const v = t.light;
  expect(contrast(v.tx, v.bg), `${label}: texto/fundo`).toBeGreaterThanOrEqual(7);
  expect(contrast(v.tx, v.card), `${label}: texto/cartão`).toBeGreaterThanOrEqual(7);
  expect(contrast(v.mut, v.bg), `${label}: secundário`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(v.link, v.card), `${label}: link/cartão`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(v.link, v.bg), `${label}: link/fundo`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(v.on, v.ac), `${label}: texto do botão`).toBeGreaterThanOrEqual(4.5);
  expect(v).toEqual(t.dark); // mesmo visual nos dois modos
}

describe("tema nobre das páginas de entrada", () => {
  it("todas as paletas prontas são legíveis", () => { for (const p of NOBLE_PRESETS) legible(buildNobleTheme(p.primary, p.accent), p.name); });
  it("qualquer par de cores escolhido continua legível", () => {
    for (const [a, b] of [["#ffffff", "#ffffff"], ["#000000", "#000000"], ["#ff0000", "#ffff00"], ["#808080", "#c0c0c0"], ["#0000ff", "#003300"]]) legible(buildNobleTheme(a, b), `${a}/${b}`);
    let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const hex = () => "#" + Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join("");
    for (let i = 0; i < 200; i++) { const a = hex(), b = hex(); legible(buildNobleTheme(a, b), `${a}/${b}`); }
  });
  it("o fundo é escuro e o acento é claro (aparência nobre)", () => {
    const t = lookTheme({ preset: "bordo-dourado", tagline: "" });
    expect(contrast(t.light.bg, "#000000")).toBeLessThan(2.2);
    expect(contrast(t.light.link, "#000000")).toBeGreaterThan(6);
    expect(themeCss(t)).toMatch(/^:root\{(--[a-z0-9]+:#[0-9a-f]{6};?)+\}@media/);
  });
});

describe("quem pode personalizar (somente administrador técnico, com 2FA)", () => {
  it("membros, Venerável, Potência e técnico sem 2FA não conseguem", async () => {
    const { db, A, B, r1, m1 } = await people();
    const [tech] = await db.insert(users).values({ email: "t@x.org", username: "tecnico", passwordHash: "x", isTechnicalAdmin: true }).returning();
    const input = { preset: "bordo-dourado", tagline: "Olá" };
    for (const who of [{ userId: r1, mfaVerified: true }, { userId: m1, mfaVerified: true }, B, A]) await expect(setPublicLook(db, who, input)).rejects.toThrow(Forbidden);
    await expect(resetPublicLook(db, B)).rejects.toThrow(Forbidden);
    await expect(setPublicLook(db, { userId: tech.id, mfaVerified: false }, input)).rejects.toThrow("mfa_required");
    expect(await getPublicLook(db)).toEqual(DEFAULT_LOOK); // nada mudou
  });
  it("o administrador técnico salva, lê, restaura; tudo auditado", async () => {
    const { db } = await people();
    const [tech] = await db.insert(users).values({ email: "t@x.org", username: "tecnico", passwordHash: "x", isTechnicalAdmin: true }).returning();
    const ctx = { userId: tech.id, mfaVerified: true };
    await setPublicLook(db, ctx, { preset: "bordo-dourado", tagline: "Entre, irmão" });
    expect(await getPublicLook(db)).toEqual({ preset: "bordo-dourado", tagline: "Entre, irmão" });
    await setPublicLook(db, ctx, { preset: "custom", primary: "#102030", accent: "#D4AF37", tagline: "" });
    expect(await getPublicLook(db)).toMatchObject({ preset: "custom", primary: "#102030", accent: "#d4af37" });
    await resetPublicLook(db, ctx);
    expect(await getPublicLook(db)).toEqual(DEFAULT_LOOK);
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
  it("recusa entradas inválidas; valor corrompido no banco cai no padrão", async () => {
    const { db } = await people();
    const [tech] = await db.insert(users).values({ email: "t@x.org", username: "tecnico", passwordHash: "x", isTechnicalAdmin: true }).returning();
    const ctx = { userId: tech.id, mfaVerified: true };
    await expect(setPublicLook(db, ctx, { preset: "inventada" })).rejects.toThrow(Invalid);
    await expect(setPublicLook(db, ctx, { preset: "custom", primary: "red", accent: "#ffffff" })).rejects.toThrow(Invalid);
    await expect(setPublicLook(db, ctx, { preset: "custom", primary: "#ffffff", accent: "red; x" })).rejects.toThrow(Invalid);
    await expect(setPublicLook(db, ctx, { preset: "azul-dourado", tagline: "x".repeat(121) })).rejects.toThrow(Invalid);
    await expect(setPublicLook(db, ctx, { preset: "azul-dourado", tagline: "a\u0000b" })).rejects.toThrow(Invalid);
    await db.insert(siteSettings).values({ key: "public_look", value: { preset: "custom", primary: "javascript:alert(1)", accent: "#fff" } });
    expect(await getPublicLook(db)).toEqual(DEFAULT_LOOK);
  });
  it("o papel de conteúdo (app_reader) não lê nem altera as configurações", async () => {
    const { db, r1 } = await people();
    await expect(withUser(db, r1, (tx) => tx.execute(sql`select * from site_settings`))).rejects.toThrow();
    await expect(withUser(db, r1, (tx) => tx.execute(sql`insert into site_settings (key, value) values ('x', '{}')`))).rejects.toThrow();
  });
});
