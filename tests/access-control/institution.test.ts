import { describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { world, ctx, PW } from "../helpers/world";
import * as inst from "@/access-control/services/institution";
import * as auth from "@/core/auth/service";
import { loadSubject } from "@/access-control/subject";
import { can } from "@/access-control/engine/can";
import { verifyAuditChain } from "@/access-control/audit/store";
import { Forbidden, Invalid } from "@/core/errors";
import { degreeAssignments, institutionalMemberships, sessions, users } from "@/shared/database/schema";
import { createInvitation, approveInvitation, registerWithInvitation } from "@/access-control/services/institution";

const past = new Date("2026-01-01"), later = new Date(Date.now() + 365 * 86_400_000);

describe("fundação", () => {
  it("exige evidência e duas pessoas distintas", async () => {
    const { db } = await world();
    const p = (e: string, u: string) => ({ email: e, username: u, fullName: u, password: PW });
    await expect(inst.bootstrapFounders(db, { jurisdictionName: "J", lodgeName: "L", authority: p("a@x.org", "aaaa"), venerable: p("b@x.org", "bbbb"), evidence: "curta" })).rejects.toThrow(Invalid);
    await expect(inst.bootstrapFounders(db, { jurisdictionName: "J", lodgeName: "L", authority: p("a@x.org", "aaaa"), venerable: p("a@x.org", "bbbb"), evidence: "Ofício 2/2026 da Potência" })).rejects.toThrow("distintas");
  });
  it("cria a estrutura e audita com cadeia íntegra", async () => {
    const { db, f } = await world();
    const vm = (await loadSubject(db, f.venerableId))!;
    expect(vm.degree).toBe(3);
    expect(vm.offices.map((o) => o.name)).toContain("Venerável Mestre");
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
  it("nega sujeito com vínculos institucionais simultaneamente vigentes", async () => {
    const { db, f, A, member } = await world();
    const target = await member({ name: "ambigua", degree: 1 });
    const other = await inst.createLodge(db, A, { jurisdictionId: f.jurisdictionId, name: "Loja Sobreposta" });
    const endsAt = new Date(Date.now() + 86_400_000);
    await db.update(institutionalMemberships).set({ endsAt })
      .where(and(eq(institutionalMemberships.userId, target), isNull(institutionalMemberships.endsAt)));
    await db.insert(institutionalMemberships).values({ userId: target, lodgeId: other.id, startsAt: new Date(Date.now() - 1_000), endsAt });
    expect(await loadSubject(db, target)).toBeNull();
  });
});

describe("convites e cadastro", () => {
  it("quem cria o convite não o aprova; a Potência aprova", async () => {
    const { db, f, A, B } = await world();
    const inv = await createInvitation(db, B, { lodgeId: f.lodgeId, email: "novo@teste.org", intendedDegree: 1 });
    await expect(approveInvitation(db, B, inv.invitationId)).rejects.toThrow(Forbidden);
    await expect(registerWithInvitation(db, { token: inv.token, email: "novo@teste.org", username: "novo", fullName: "Novo", password: PW })).rejects.toThrow("não aprovado");
    await approveInvitation(db, A, inv.invitationId);
    await expect(registerWithInvitation(db, { token: inv.token, email: "outro@teste.org", username: "novo", fullName: "N", password: PW })).rejects.toThrow(Invalid);
    const r = await registerWithInvitation(db, { token: inv.token, email: "novo@teste.org", username: "novo", fullName: "Novo", password: PW });
    expect((await loadSubject(db, r.userId))?.degree).toBe(1);
    await expect(registerWithInvitation(db, { token: inv.token, email: "novo@teste.org", username: "novo2", fullName: "N", password: PW })).rejects.toThrow(Invalid);
  });
  it("convite expirado não registra", async () => {
    const { db, f, A, B } = await world();
    const inv = await createInvitation(db, B, { lodgeId: f.lodgeId, email: "e@teste.org", intendedDegree: 1 });
    await approveInvitation(db, A, inv.invitationId);
    await expect(registerWithInvitation(db, { token: inv.token, email: "e@teste.org", username: "expir", fullName: "E", password: PW }, new Date(Date.now() + 20 * 86_400_000))).rejects.toThrow(Invalid);
  });
  it("membro comum e administrador técnico não convidam", async () => {
    const { db, f, member } = await world();
    const comum = await member({ name: "comum", degree: 2 });
    await expect(createInvitation(db, ctx(comum), { lodgeId: f.lodgeId, email: "x@t.org", intendedDegree: 1 })).rejects.toThrow(Forbidden);
    const [tech] = await db.insert(users).values({ email: "tec@t.org", username: "tecnico", passwordHash: "x", isTechnicalAdmin: true }).returning();
    await expect(createInvitation(db, ctx(tech.id), { lodgeId: f.lodgeId, email: "x@t.org", intendedDegree: 1 })).rejects.toThrow(Forbidden);
  });
});

describe("importação com Grau acima de Aprendiz", () => {
  it("só a Potência aprova convite com Grau elevado; o Venerável não", async () => {
    const { db, f, A, B, member } = await world();
    const sec = await member({ name: "secimport", degree: 3 });
    await inst.appointOffice(db, B, { userId: sec, name: "Secretário", lodgeId: f.lodgeId, startsAt: past });
    const inv = await createInvitation(db, ctx(sec), { lodgeId: f.lodgeId, email: "mestre-importado@teste.org", intendedDegree: 3 });
    await expect(approveInvitation(db, B, inv.invitationId)).rejects.toThrow("Administração da Potência");
    await approveInvitation(db, A, inv.invitationId);
    const r = await registerWithInvitation(db, { token: inv.token, email: "mestre-importado@teste.org", username: "importado", fullName: "Importado", password: PW });
    expect((await loadSubject(db, r.userId))?.degree).toBe(3);
    await expect(createInvitation(db, B, { lodgeId: f.lodgeId, email: "x@t.org", intendedDegree: 0 })).rejects.toThrow(Invalid);
  });
  it("Administração da Potência pode admitir Aprendiz diretamente, mas não autoaprovar Grau superior", async () => {
    const { db, f, A } = await world();
    const inv = await createInvitation(db, A, { lodgeId: f.lodgeId, email: "direto@teste.org", intendedDegree: 1 });
    await expect(approveInvitation(db, A, inv.invitationId)).rejects.toThrow("convite");
    const r = await registerWithInvitation(db, { token: inv.token, email: "direto@teste.org", username: "direto", fullName: "Direto", password: PW });
    const [assignment] = await db.select().from(degreeAssignments).where(eq(degreeAssignments.userId, r.userId));
    expect(assignment.origin).toBe("potencia_direct");
    await expect(createInvitation(db, A, { lodgeId: f.lodgeId, email: "grau3@teste.org", intendedDegree: 3 })).rejects.toThrow("Loja deve registrar");
  });
  it("convite de Aprendiz segue aprovado pelo Venerável", async () => {
    const { db, f, A, B, member } = await world();
    const sec = await member({ name: "secnormal", degree: 3 });
    await inst.appointOffice(db, B, { userId: sec, name: "Secretário", lodgeId: f.lodgeId, startsAt: past });
    const inv = await createInvitation(db, ctx(sec), { lodgeId: f.lodgeId, email: "apr@teste.org", intendedDegree: 1 });
    await expect(approveInvitation(db, B, inv.invitationId)).resolves.toBeUndefined();
    void A;
  });
});

describe("progressão de Grau", () => {
  it("Secretário registra, Venerável aprova; ACE reavalia", async () => {
    const { db, f, B, member } = await world();
    const sec = await member({ name: "secretario", degree: 3 });
    await inst.appointOffice(db, B, { userId: sec, name: "Secretário", lodgeId: f.lodgeId, startsAt: past });
    const S = ctx(sec);
    const ric = await member({ name: "ricardo", degree: 1, inviter: S, approver: B });
    const policy = { id: "simb", policy: { kind: "minDegree", value: 2 } as const };
    expect(can((await loadSubject(db, ric))!, "read", policy).allow).toBe(false);
    const rq = await inst.requestDegree(db, S, ric);
    await expect(inst.decideDegree(db, S, rq.id, true)).rejects.toThrow(Forbidden); // registrante não aprova
    await expect(inst.decideDegree(db, ctx(ric), rq.id, true)).rejects.toThrow(Forbidden);
    await expect(inst.decideDegree(db, B, rq.id, false)).rejects.toThrow("justifique");
    await inst.decideDegree(db, B, rq.id, true);
    expect(can((await loadSubject(db, ric))!, "read", policy).allow).toBe(true);
    await expect(inst.decideDegree(db, B, rq.id, true)).rejects.toThrow(); // já decidida
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
  it("ninguém solicita o próprio Grau; só uma solicitação pendente; sem pular Graus", async () => {
    const { db, f, B, member } = await world();
    const m = await member({ name: "membro", degree: 1 });
    await expect(inst.requestDegree(db, B, f.venerableId)).rejects.toThrow(Forbidden);
    const r = await inst.requestDegree(db, B, m);
    expect(r.toDegree).toBe(2);
    await expect(inst.requestDegree(db, B, m)).rejects.toThrow("pendente");
  });
  it("o banco recusa aprovação dupla violada mesmo por SQL direto", async () => {
    const { db, member, f } = await world();
    const m = await member({ name: "alvo", degree: 1 });
    await expect(db.insert(degreeAssignments).values({ userId: m, degree: 2, requestedBy: f.venerableId, approvedBy: f.venerableId })).rejects.toThrow();
    await expect(db.insert(degreeAssignments).values({ userId: m, degree: 2, requestedBy: f.venerableId, approvedBy: m })).rejects.toThrow();
  });
  it("histórico de Graus é imutável", async () => {
    const { db } = await world();
    await expect(db.execute(sql`update degree_assignments set degree = 33`)).rejects.toThrow();
    await expect(db.execute(sql`delete from degree_assignments`)).rejects.toThrow();
  });
});

describe("cargos e mandatos", () => {
  it("cargo expirado perde as permissões; só um Venerável por vez", async () => {
    const { db, f, A, B, member } = await world();
    const sec = await member({ name: "sec", degree: 3 });
    await inst.appointOffice(db, B, { userId: sec, name: "Secretário", lodgeId: f.lodgeId, startsAt: past, endsAt: new Date(Date.now() + 60_000) });
    await expect(createInvitation(db, ctx(sec), { lodgeId: f.lodgeId, email: "ok@t.org", intendedDegree: 1 })).resolves.toBeTruthy();
    await expect(createInvitation(db, ctx(sec), { lodgeId: f.lodgeId, email: "tarde@t.org", intendedDegree: 1 }, new Date(Date.now() + 120_000))).rejects.toThrow(Forbidden);
    const novo = await member({ name: "novovm", degree: 3 });
    await expect(inst.appointOffice(db, A, { userId: novo, name: "Venerável Mestre", lodgeId: f.lodgeId, startsAt: new Date() })).rejects.toThrow("já existe");
    await expect(inst.appointOffice(db, B, { userId: novo, name: "Venerável Mestre", lodgeId: f.lodgeId, startsAt: later })).rejects.toThrow(Forbidden);
  });
  it("cargo exige Mestre; Venerável não nomeia em outra Loja", async () => {
    const { db, f, A, B, member } = await world();
    const apr = await member({ name: "aprendiz", degree: 1 });
    await expect(inst.appointOffice(db, B, { userId: apr, name: "Orador", lodgeId: f.lodgeId, startsAt: past })).rejects.toThrow(Invalid);
    const l2 = await inst.createLodge(db, A, { jurisdictionId: f.jurisdictionId, name: "Loja Dois", number: 2 });
    await expect(inst.createLodge(db, B, { jurisdictionId: f.jurisdictionId, name: "X" })).rejects.toThrow(Forbidden);
    const pot2 = await member({ name: "potdois", degree: 3 }); // segunda autoridade: uma Loja nova não tem Venerável para aprovar
    await inst.appointOffice(db, A, { userId: pot2, name: "Administração da Potência", jurisdictionId: f.jurisdictionId, startsAt: past });
    const m2 = await member({ name: "mestre2", degree: 3, lodgeId: l2.id, inviter: A, approver: ctx(pot2) });
    await expect(inst.appointOffice(db, B, { userId: m2, name: "Orador", lodgeId: l2.id, startsAt: past })).rejects.toThrow(Forbidden);
    const vm2 = await inst.appointOffice(db, A, { userId: m2, name: "Venerável Mestre", lodgeId: l2.id, startsAt: past });
    await expect(inst.endOffice(db, B, vm2.id)).rejects.toThrow(Forbidden);
    await inst.endOffice(db, A, vm2.id);
  });
  it("exige sessão com 2FA de quem exerce cargo", async () => {
    const { db, f, B } = await world();
    await expect(createInvitation(db, ctx(B.userId, false), { lodgeId: f.lodgeId, email: "x@t.org", intendedDegree: 1 })).rejects.toThrow("mfa_required");
  });
});

describe("status do membro", () => {
  it("suspensão bloqueia o ACE e revoga sessões; ninguém altera o próprio", async () => {
    const { db, B, member } = await world();
    const m = await member({ name: "suspenso", degree: 3 });
    const l = await auth.login(db, { email: "suspenso@teste.org", password: PW });
    await expect(inst.setMemberStatus(db, B, m, "suspenso", "x")).rejects.toThrow("justificativa");
    await expect(inst.setMemberStatus(db, ctx(m), m, "regular", "autoalteração")).rejects.toThrow(Forbidden);
    await inst.setMemberStatus(db, B, m, "suspenso", "pendência disciplinar");
    expect(can((await loadSubject(db, m))!, "read", { id: "x", policy: { kind: "minDegree", value: 1 } }).allow).toBe(false);
    expect(await auth.validateSession(db, l.token)).toBeNull();
    const rows = await db.select().from(sessions).where(eq(sessions.userId, m));
    expect(rows.every((r) => r.revokedAt)).toBe(true);
  });
});

describe("auditoria", () => {
  it("é imutável no banco e detecta adulteração por SQL do dono", async () => {
    const { db } = await world();
    await expect(db.execute(sql`update access_audit_logs set action = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from access_audit_logs`)).rejects.toThrow();
    await expect(db.execute(sql`truncate access_audit_logs`)).rejects.toThrow();
    // quem tem poder de desativar trigger (superusuário) altera, e a cadeia acusa
    await db.execute(sql`alter table access_audit_logs disable trigger audit_immutable`);
    await db.execute(sql`update access_audit_logs set action = 'forjado' where seq = 1`);
    expect((await verifyAuditChain(db)).ok).toBe(false);
  });
  it("cada autoridade lê só o próprio escopo", async () => {
    const { db, f, A, B, member } = await world();
    const l2 = await inst.createLodge(db, A, { jurisdictionId: f.jurisdictionId, name: "Loja Dois", number: 2 });
    const pot2 = await member({ name: "potdois", degree: 3 }); // segunda autoridade: uma Loja nova não tem Venerável para aprovar
    await inst.appointOffice(db, A, { userId: pot2, name: "Administração da Potência", jurisdictionId: f.jurisdictionId, startsAt: past });
    const m2 = await member({ name: "vm2", degree: 3, lodgeId: l2.id, inviter: A, approver: ctx(pot2) });
    await inst.appointOffice(db, A, { userId: m2, name: "Venerável Mestre", lodgeId: l2.id, startsAt: past });
    const v1 = await inst.listAudit(db, B), v2 = await inst.listAudit(db, ctx(m2)), pot = await inst.listAudit(db, A);
    expect(v1.length).toBeGreaterThan(0);
    expect(v1.every((e) => (e.payload as { lodgeId?: string }).lodgeId === f.lodgeId)).toBe(true);
    expect(v2.every((e) => (e.payload as { lodgeId?: string }).lodgeId === l2.id)).toBe(true);
    expect(pot.length).toBeGreaterThanOrEqual(v1.length + v2.length);
    const comum = await member({ name: "comum2", degree: 2 });
    await expect(inst.listAudit(db, ctx(comum))).rejects.toThrow(Forbidden);
  });
});
