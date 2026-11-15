import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { people } from "../helpers/people";
import { PW, ctx } from "../helpers/world";
import * as auth from "@/core/auth/service";
import { remainingRecoveryCodes } from "@/core/auth/recovery";
import { totpAt } from "@/core/auth/totp";
import * as inst from "@/access-control/services/institution";
import { verifyAuditChain } from "@/access-control/audit/store";
import { loadSubject } from "@/access-control/subject";
import { Forbidden, Invalid } from "@/core/errors";
import { degreeAssignments, userTotp, users } from "@/shared/database/schema";

const T0 = new Date("2026-11-20T12:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);

/** Ativa o 2FA para o usuário e devolve o segredo e os códigos de recuperação. */
async function withMfa(db: Awaited<ReturnType<typeof people>>["db"], userId: string, email: string) {
  const { secret } = await auth.enrollTotp(db, userId, email);
  const codes = await auth.confirmTotp(db, userId, totpAt(secret, T0.getTime()), T0);
  return { secret, codes };
}

describe("2FA: códigos de recuperação", () => {
  it("ativar gera 10 códigos; cada um entra uma única vez", async () => {
    const { db, r1 } = await people();
    const { codes } = await withMfa(db, r1, "aprendiz@teste.org");
    expect(codes).toHaveLength(10);
    expect(codes.every((c) => /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(c))).toBe(true);
    expect(await remainingRecoveryCodes(db, r1)).toBe(10);
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(5));
    expect(l.status).toBe("mfa_required");
    await auth.verifyMfa(db, l.token, codes[0].toUpperCase(), at(5)); // aceita maiúsculas
    expect((await auth.validateSession(db, l.token, at(5)))?.mfaVerified).toBe(true);
    expect(await remainingRecoveryCodes(db, r1)).toBe(9);
    const l2 = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(6));
    await expect(auth.verifyMfa(db, l2.token, codes[0], at(6))).rejects.toThrow("código inválido"); // já usado
    await auth.verifyMfa(db, l2.token, codes[1], at(6));
  });
  it("novos códigos invalidam os antigos e exigem a senha", async () => {
    const { db, r1 } = await people();
    const { codes } = await withMfa(db, r1, "aprendiz@teste.org");
    await expect(auth.regenerateRecoveryCodes(db, r1, "senha-errada-qualquer")).rejects.toThrow("senha incorreta");
    const novos = await auth.regenerateRecoveryCodes(db, r1, PW);
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(5));
    await expect(auth.verifyMfa(db, l.token, codes[0], at(5))).rejects.toThrow("código inválido");
    await auth.verifyMfa(db, l.token, novos[0], at(5));
  });
  it("limita tentativas de código (força bruta)", async () => {
    const { db, r1 } = await people();
    await withMfa(db, r1, "aprendiz@teste.org");
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(5));
    for (let i = 0; i < 10; i++) await expect(auth.verifyMfa(db, l.token, "000000", at(5))).rejects.toThrow();
    await expect(auth.verifyMfa(db, l.token, "000000", at(5))).rejects.toThrow("muitas tentativas");
  });
  it("trocar de aplicativo: exige senha e código; o segredo antigo deixa de valer", async () => {
    const { db, r1 } = await people();
    const { secret } = await withMfa(db, r1, "aprendiz@teste.org");
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(5));
    await auth.verifyMfa(db, l.token, totpAt(secret, at(5).getTime()), at(5));
    const s = (await auth.validateSession(db, l.token, at(5)))!;
    const outra = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(5));
    await expect(auth.replaceTotp(db, s, "senha-errada-qualquer", totpAt(secret, at(7).getTime()), at(7))).rejects.toThrow("senha incorreta");
    await expect(auth.replaceTotp(db, s, PW, "000000", at(7))).rejects.toThrow("código inválido");
    await auth.replaceTotp(db, s, PW, totpAt(secret, at(9).getTime()), at(9));
    expect(await auth.hasMfa(db, r1)).toBe(false);
    expect(await auth.validateSession(db, outra.token, at(9))).toBeNull(); // outras sessões encerradas
    const novo = await auth.enrollTotp(db, r1, "aprendiz@teste.org");
    expect(novo.secret).not.toBe(secret);
    await auth.confirmTotp(db, r1, totpAt(novo.secret, at(12).getTime()), at(12));
    expect(await auth.hasMfa(db, r1)).toBe(true);
  });
});

describe("2FA: redefinição pela autoridade (perdeu o autenticador e os códigos)", () => {
  it("o Venerável redefine o de um membro; ele volta a entrar e cadastra um novo", async () => {
    const { db, B, r1 } = await people();
    await withMfa(db, r1, "aprendiz@teste.org");
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(5));
    await expect(inst.resetMemberTotp(db, B, r1, "x")).rejects.toThrow("justificativa");
    await inst.resetMemberTotp(db, B, r1, "perdeu o aparelho; identidade confirmada na sessão");
    expect(await auth.hasMfa(db, r1)).toBe(false);
    expect(await remainingRecoveryCodes(db, r1)).toBe(0);
    expect(await auth.validateSession(db, l.token, at(5))).toBeNull();
    expect((await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(6))).status).toBe("ok");
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
  it("membro comum não redefine; ninguém redefine o próprio; a Potência só por outra da Potência", async () => {
    const { db, A, B, r1, c1, pot2 } = await people();
    await expect(inst.resetMemberTotp(db, ctx(r1), c1, "tentativa indevida")).rejects.toThrow(Forbidden);
    await expect(inst.resetMemberTotp(db, B, B.userId, "autoalteração")).rejects.toThrow(Forbidden);
    await expect(inst.resetMemberTotp(db, B, A.userId, "o Venerável não mexe na Potência")).rejects.toThrow(Forbidden);
    await withMfa(db, A.userId, "potencia@teste.org");
    await inst.resetMemberTotp(db, ctx(pot2), A.userId, "autoridade perdeu o aparelho"); // outra autoridade da Potência
    expect(await auth.hasMfa(db, A.userId)).toBe(false);
  });
});

describe("troca de e-mail", () => {
  it("o próprio usuário: senha + link no novo endereço; o antigo deixa de entrar", async () => {
    const { db, r1, c1 } = await people();
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(1));
    const s = (await auth.validateSession(db, l.token, at(1)))!;
    await expect(auth.requestEmailChange(db, s, "senha-errada-qualquer", "novo@exemplo.org", at(1))).rejects.toThrow("senha incorreta");
    await expect(auth.requestEmailChange(db, s, PW, "companheiro@teste.org", at(1))).rejects.toThrow("já está em uso");
    await expect(auth.requestEmailChange(db, s, PW, "invalido", at(1))).rejects.toThrow("inválido");
    const r = await auth.requestEmailChange(db, s, PW, "  NOVO@Exemplo.org ", at(1));
    expect(r.newEmail).toBe("novo@exemplo.org");
    expect((await db.select().from(users).where(eq(users.id, r1)))[0].email).toBe("aprendiz@teste.org"); // ainda não mudou
    const done = await auth.confirmEmailChange(db, r.token, at(2));
    expect(done).toEqual({ oldEmail: "aprendiz@teste.org", newEmail: "novo@exemplo.org" });
    await expect(auth.confirmEmailChange(db, r.token, at(3))).rejects.toThrow("inválido"); // uso único
    expect(await auth.validateSession(db, l.token, at(3))).toBeNull();
    await expect(auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(4))).rejects.toThrow("credenciais inválidas");
    expect((await auth.login(db, { email: "novo@exemplo.org", password: PW }, at(4))).status).toBe("ok");
    void c1;
  });
  it("link expira e não vale se o e-mail foi tomado nesse meio tempo", async () => {
    const { db, r1, c1 } = await people();
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW }, at(1));
    const s = (await auth.validateSession(db, l.token, at(1)))!;
    const r = await auth.requestEmailChange(db, s, PW, "livre@exemplo.org", at(1));
    await expect(auth.confirmEmailChange(db, r.token, at(90))).rejects.toThrow("expirado");
    const r2 = await auth.requestEmailChange(db, s, PW, "disputa@exemplo.org", at(2));
    await db.update(users).set({ email: "disputa@exemplo.org" }).where(eq(users.id, c1));
    await expect(auth.confirmEmailChange(db, r2.token, at(3))).rejects.toThrow("já está em uso");
    void r1;
  });
  it("a autoridade troca o e-mail de quem perdeu o acesso: sessões caem e exige confirmar o novo", async () => {
    const { db, B, r1 } = await people();
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW });
    await expect(inst.changeMemberEmail(db, B, r1, "novo@exemplo.org", "x")).rejects.toThrow("justificativa");
    await expect(inst.changeMemberEmail(db, B, r1, "vm@teste.org", "e-mail antigo sem acesso")).rejects.toThrow("já está em uso");
    const { verifyToken } = await inst.changeMemberEmail(db, B, r1, "novo@exemplo.org", "e-mail antigo sem acesso");
    expect(await auth.validateSession(db, l.token)).toBeNull();
    await expect(auth.login(db, { email: "novo@exemplo.org", password: PW })).rejects.toThrow("e-mail não verificado");
    await auth.verifyEmail(db, verifyToken);
    expect((await auth.login(db, { email: "novo@exemplo.org", password: PW })).status).toBe("ok");
    const audit = (await db.execute(sql`select payload from access_audit_logs where action = 'member.email_changed'`) as unknown as { rows: { payload: { from: string; to: string } }[] }).rows[0].payload;
    expect(audit.from).toBe("a***@teste.org"); expect(audit.to).toBe("n***@exemplo.org"); // sem endereços completos na auditoria
  });
  it("membro comum não troca o e-mail de outro", async () => {
    const { db, r1, c1 } = await people();
    await expect(inst.changeMemberEmail(db, ctx(r1), c1, "x@exemplo.org", "tentativa indevida")).rejects.toThrow(Forbidden);
  });
});

describe("convites: e-mail repetido e aprovação direta da Potência", () => {
  it("e-mail que já tem conta ou já tem convite pendente é recusado na hora, com o motivo", async () => {
    const { db, f, B } = await people();
    await expect(inst.createInvitation(db, B, { lodgeId: f.lodgeId, email: "aprendiz@teste.org", intendedDegree: 1 })).rejects.toThrow("já existe uma conta com este e-mail");
    const inv = await inst.createInvitation(db, B, { lodgeId: f.lodgeId, email: "novo@exemplo.org", intendedDegree: 1 });
    await expect(inst.createInvitation(db, B, { lodgeId: f.lodgeId, email: " NOVO@exemplo.org ", intendedDegree: 1 })).rejects.toThrow("convite pendente");
    await inst.revokeInvitation(db, B, inv.invitationId);
    await expect(inst.registerWithInvitation(db, { token: inv.token, email: "novo@exemplo.org", username: "novo", fullName: "N", password: PW })).rejects.toThrow(Invalid); // cancelado
    await expect(inst.createInvitation(db, B, { lodgeId: f.lodgeId, email: "novo@exemplo.org", intendedDegree: 1 })).resolves.toBeTruthy(); // pode convidar de novo
  });
  it("a Potência convida já aprovado, em qualquer Grau; Venerável e Secretário não", async () => {
    const { db, f, A, B, member } = await people();
    const sec = await member({ name: "secdireto", degree: 3 });
    await inst.appointOffice(db, B, { userId: sec, name: "Secretário", lodgeId: f.lodgeId, startsAt: new Date("2026-01-01") });
    await expect(inst.createInvitation(db, B, { lodgeId: f.lodgeId, email: "a@exemplo.org", intendedDegree: 3, approveNow: true })).rejects.toThrow(Forbidden);
    await expect(inst.createInvitation(db, ctx(sec), { lodgeId: f.lodgeId, email: "a@exemplo.org", intendedDegree: 1, approveNow: true })).rejects.toThrow(Forbidden);
    const inv = await inst.createInvitation(db, A, { lodgeId: f.lodgeId, email: "mestre.direto@exemplo.org", intendedDegree: 3, approveNow: true });
    expect(inv.approved).toBe(true);
    const r = await inst.registerWithInvitation(db, { token: inv.token, email: "mestre.direto@exemplo.org", username: "direto", fullName: "Direto", password: PW });
    expect((await loadSubject(db, r.userId))?.degree).toBe(3);
    const [d] = await db.select().from(degreeAssignments).where(eq(degreeAssignments.userId, r.userId));
    expect(d.origin).toBe("potencia");
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
  it("o banco continua recusando auto-aprovação com origem comum", async () => {
    const { db, A, r1 } = await people();
    await expect(db.insert(degreeAssignments).values({ userId: r1, degree: 2, origin: "regular", requestedBy: A.userId, approvedBy: A.userId })).rejects.toThrow();
  });
  it("cadastro: mensagens específicas para usuário ou e-mail já existentes", async () => {
    const { db, f, A, B } = await people();
    const inv = await inst.createInvitation(db, B, { lodgeId: f.lodgeId, email: "livre@exemplo.org", intendedDegree: 1 });
    await inst.approveInvitation(db, A, inv.invitationId);
    await expect(inst.registerWithInvitation(db, { token: inv.token, email: "livre@exemplo.org", username: "aprendiz", fullName: "X", password: PW })).rejects.toThrow("nome de usuário já está em uso");
    await db.insert(users).values({ email: "livre@exemplo.org", username: "chegou-antes", passwordHash: "x" });
    await expect(inst.registerWithInvitation(db, { token: inv.token, email: "livre@exemplo.org", username: "outro", fullName: "X", password: PW })).rejects.toThrow("Já existe uma conta com este e-mail");
    expect((await db.select().from(userTotp)).length).toBe(0);
  });
});
