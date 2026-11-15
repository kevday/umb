import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "../helpers/db";
import { users } from "@/shared/database/schema";
import { hashPassword, verifyPassword, assertPasswordPolicy } from "@/core/auth/password";
import { b32decode, b32encode, hotp, totpAt, verifyTotp } from "@/core/auth/totp";
import { decrypt, encrypt } from "@/core/auth/crypto";
import * as auth from "@/core/auth/service";
import { Invalid } from "@/core/errors";

const PW = "senha-de-teste-forte-1";
async function setup() {
  const db = await testDb();
  const [u] = await db.insert(users).values({ email: "a@t.org", username: "a", passwordHash: await hashPassword(PW), emailVerifiedAt: new Date() }).returning();
  return { db, u };
}

describe("senha e criptografia", () => {
  it("Argon2id verifica e rejeita", async () => {
    const h = await hashPassword(PW);
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, PW)).toBe(true);
    expect(await verifyPassword(h, "outra-senha-qualquer")).toBe(false);
  });
  it("política de senha", () => {
    expect(() => assertPasswordPolicy("curta")).toThrow(Invalid);
    expect(() => assertPasswordPolicy("meuemail@teste.org-123", "meuemail@teste.org")).toThrow(Invalid);
    expect(() => assertPasswordPolicy(PW)).not.toThrow();
  });
  it("AES-GCM ida e volta, e detecta adulteração", () => {
    const c = encrypt("segredo");
    expect(decrypt(c)).toBe("segredo");
    const [iv, tag, ct] = c.split(".");
    expect(() => decrypt([iv, tag, Buffer.from("x" + ct).toString("base64")].join("."))).toThrow();
  });
});

describe("TOTP (RFC 6238)", () => {
  const secret = b32encode(Buffer.from("12345678901234567890"));
  it("base32 ida e volta", () => expect(b32decode(secret).toString()).toBe("12345678901234567890"));
  it("vetor oficial T=59 s", () => expect(hotp(b32decode(secret), 1, 8)).toBe("94287082"));
  it("janela ±1 e rejeição fora dela", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now), now)).not.toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now - 120_000), now)).toBeNull();
    expect(verifyTotp(secret, "abc123", now)).toBeNull();
  });
});

describe("login, sessões e bloqueio", () => {
  it("login ok cria sessão válida; logout revoga", async () => {
    const { db } = await setup();
    const r = await auth.login(db, { email: " A@t.org ", password: PW });
    expect(r.status).toBe("ok");
    expect((await auth.validateSession(db, r.token))?.mfaVerified).toBe(false);
    await auth.logout(db, r.token);
    expect(await auth.validateSession(db, r.token)).toBeNull();
  });
  it("erros são genéricos e e-mail não verificado é recusado", async () => {
    const { db, u } = await setup();
    await expect(auth.login(db, { email: "a@t.org", password: "errada-errada-12" })).rejects.toThrow("credenciais inválidas");
    await expect(auth.login(db, { email: "nao@existe.org", password: PW })).rejects.toThrow("credenciais inválidas");
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, u.id));
    await expect(auth.login(db, { email: "a@t.org", password: PW })).rejects.toThrow("e-mail não verificado");
  });
  it("bloqueia após 5 falhas, mesmo com a senha certa, por 15 minutos", async () => {
    const { db } = await setup();
    const t0 = new Date("2026-11-08T12:00:00Z");
    for (let i = 0; i < 5; i++) await expect(auth.login(db, { email: "a@t.org", password: "errada-errada-12" }, t0)).rejects.toThrow();
    await expect(auth.login(db, { email: "a@t.org", password: PW }, new Date(t0.getTime() + 60_000))).rejects.toThrow("credenciais inválidas");
    const later = await auth.login(db, { email: "a@t.org", password: PW }, new Date(t0.getTime() + 16 * 60_000));
    expect(later.status).toBe("ok");
  });
  it("sessão expira por inatividade e por duração absoluta", async () => {
    const { db } = await setup();
    const t0 = new Date("2026-11-08T12:00:00Z");
    const r = await auth.login(db, { email: "a@t.org", password: PW }, t0);
    expect(await auth.validateSession(db, r.token, new Date(t0.getTime() + 8 * 86_400_000))).toBeNull();
    const r2 = await auth.login(db, { email: "a@t.org", password: PW }, t0);
    let t = t0.getTime();
    for (let d = 0; d < 4; d++) { t += 6 * 86_400_000; await auth.validateSession(db, r2.token, new Date(t)); }
    expect(await auth.validateSession(db, r2.token, new Date(t0.getTime() + 31 * 86_400_000))).toBeNull();
  });
});

describe("2FA", () => {
  it("duas requisições concorrentes não consomem o mesmo passo TOTP", async () => {
    const { db, u } = await setup();
    const t0 = new Date("2026-11-08T12:00:00Z");
    const { secret } = await auth.enrollTotp(db, u.id, "a@t.org");
    await auth.confirmTotp(db, u.id, totpAt(secret, t0.getTime()), t0);
    const t1 = new Date(t0.getTime() + 30_000);
    const a = await auth.login(db, { email: "a@t.org", password: PW }, t1);
    const b = await auth.login(db, { email: "a@t.org", password: PW }, t1);
    const code = totpAt(secret, t1.getTime());
    const results = await Promise.allSettled([
      auth.verifyMfa(db, a.token, code, t1),
      auth.verifyMfa(db, b.token, code, t1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("cadastro, login em duas etapas e bloqueio de reuso do código", async () => {
    const { db, u } = await setup();
    const t0 = new Date("2026-11-08T12:00:00Z");
    const { secret, uri } = await auth.enrollTotp(db, u.id, "a@t.org");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    await expect(auth.confirmTotp(db, u.id, "000000", t0)).rejects.toThrow(Invalid);
    await auth.confirmTotp(db, u.id, totpAt(secret, t0.getTime()), t0);
    await expect(auth.enrollTotp(db, u.id, "a@t.org")).rejects.toThrow("já ativado");
    const l = await auth.login(db, { email: "a@t.org", password: PW }, t0);
    expect(l.status).toBe("mfa_required");
    expect((await auth.validateSession(db, l.token, t0))?.mfaRequired).toBe(true);
    const t1 = new Date(t0.getTime() + 60_000);
    const code = totpAt(secret, t1.getTime());
    await auth.verifyMfa(db, l.token, code, t1);
    expect((await auth.validateSession(db, l.token, t1))?.mfaVerified).toBe(true);
    const l2 = await auth.login(db, { email: "a@t.org", password: PW }, t1);
    await expect(auth.verifyMfa(db, l2.token, code, t1)).rejects.toThrow("código inválido");
  });
});

describe("recuperação 2FA", () => {
  it("exige sessão recém-autenticada e confirmação pelo e-mail para remover o autenticador", async () => {
    const { db, u } = await setup();
    const t0 = new Date("2026-11-08T12:00:00Z");
    const { secret } = await auth.enrollTotp(db, u.id, "a@t.org");
    await auth.confirmTotp(db, u.id, totpAt(secret, t0.getTime()), t0);
    const login = await auth.login(db, { email: "a@t.org", password: PW }, new Date(t0.getTime() + 30_000));
    const reset = await auth.requestMfaReset(db, login.token, new Date(t0.getTime() + 30_000));
    expect(reset.email).toBe("a@t.org");
    await auth.confirmMfaReset(db, reset.token, new Date(t0.getTime() + 31_000));
    expect(await auth.hasMfa(db, u.id)).toBe(false);
    expect(await auth.validateSession(db, login.token, new Date(t0.getTime() + 32_000))).toBeNull();
  });
});

describe("alteração de e-mail", () => {
  it("exige senha atual, confirma o novo endereço e revoga sessões", async () => {
    const { db, u } = await setup();
    const login = await auth.login(db, { email: "a@t.org", password: PW });
    const session = (await auth.validateSession(db, login.token))!;
    await expect(auth.requestEmailChange(db, session, "senha-incorreta", "novo@t.org")).rejects.toThrow("senha atual incorreta");
    const request = await auth.requestEmailChange(db, session, PW, "Novo@T.org");
    await auth.confirmEmailChange(db, request.token);
    expect(await auth.validateSession(db, login.token)).toBeNull();
    const next = await auth.login(db, { email: "novo@t.org", password: PW });
    expect(next.status).toBe("ok");
    await expect(auth.login(db, { email: "a@t.org", password: PW })).rejects.toThrow("credenciais inválidas");
    void u;
  });
  it("não permite alterar para e-mail já utilizado", async () => {
    const { db, u } = await setup();
    await db.insert(users).values({ email: "b@t.org", username: "buser", passwordHash: await hashPassword(PW), emailVerifiedAt: new Date() });
    const login = await auth.login(db, { email: "a@t.org", password: PW });
    const session = (await auth.validateSession(db, login.token))!;
    await expect(auth.requestEmailChange(db, session, PW, "b@t.org")).rejects.toThrow("já está associado");
    void u;
  });
});

describe("tokens de e-mail", () => {
  it("verificação é de uso único e expira", async () => {
    const { db, u } = await setup();
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, u.id));
    const t = await auth.issueEmailToken(db, u.id, "verify");
    await auth.verifyEmail(db, t);
    await expect(auth.verifyEmail(db, t)).rejects.toThrow("inválido");
    const t2 = await auth.issueEmailToken(db, u.id, "verify", new Date("2020-01-01"));
    await expect(auth.verifyEmail(db, t2)).rejects.toThrow("expirado");
  });
  it("redefinição troca a senha e revoga sessões; troca de senha preserva a sessão atual", async () => {
    const { db } = await setup();
    const l = await auth.login(db, { email: "a@t.org", password: PW });
    expect(await auth.requestPasswordReset(db, "naoexiste@t.org")).toBeNull();
    const tk = (await auth.requestPasswordReset(db, "a@t.org"))!;
    await expect(auth.resetPassword(db, tk, "curta")).rejects.toThrow(Invalid);
    const tk2 = (await auth.requestPasswordReset(db, "a@t.org"))!;
    await auth.resetPassword(db, tk2, "nova-senha-bem-forte-9");
    expect(await auth.validateSession(db, l.token)).toBeNull();
    const l2 = await auth.login(db, { email: "a@t.org", password: "nova-senha-bem-forte-9" });
    const s2 = (await auth.validateSession(db, l2.token))!;
    const other = await auth.login(db, { email: "a@t.org", password: "nova-senha-bem-forte-9" });
    await auth.changePassword(db, s2, "nova-senha-bem-forte-9", "outra-senha-ainda-melhor-3");
    expect(await auth.validateSession(db, other.token)).toBeNull();
    expect(await auth.validateSession(db, l2.token)).not.toBeNull();
  });
});
