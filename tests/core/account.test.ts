import { describe, expect, it } from "vitest";
import { people } from "../helpers/people";
import { PW, ctx } from "../helpers/world";
import { deleteAccount, exportMyData, updateProfile } from "@/core/account";
import { throttle } from "@/core/auth/throttle";
import * as auth from "@/core/auth/service";
import * as com from "@/core/social/communities";
import * as fr from "@/core/social/friends";
import * as sb from "@/core/social/scrapbook";
import { verifyAuditChain } from "@/access-control/audit/store";
import { Invalid } from "@/core/errors";

describe("limite de tentativas", () => {
  it("bloqueia acima do limite e reabre na janela seguinte", async () => {
    const { db } = await people();
    const t0 = new Date("2026-11-08T12:00:00Z");
    for (let i = 0; i < 3; i++) await throttle(db, "login:1.2.3.4", 3, 600_000, t0);
    await expect(throttle(db, "login:1.2.3.4", 3, 600_000, t0)).rejects.toThrow(Invalid);
    await throttle(db, "login:9.9.9.9", 3, 600_000, t0); // outra chave não é afetada
    await expect(throttle(db, "login:1.2.3.4", 3, 600_000, new Date(t0.getTime() + 601_000))).resolves.toBeUndefined();
  });
});

describe("LGPD: exportação e exclusão", () => {
  it("exporta só os dados do titular, sem segredos", async () => {
    const { db, r1, c1 } = await people();
    await com.createCommunity(db, c1, { slug: "aberta", name: "Aberta", policy: { kind: "minDegree", value: 1 } });
    await com.createTopic(db, r1, "aberta", { title: "Meu tópico", body: "texto" });
    await com.createTopic(db, c1, "aberta", { title: "Do outro", body: "texto" });
    await updateProfile(db, r1, { displayName: "Ric", bio: "Estudante" });
    const x = await exportMyData(db, r1);
    expect(x.topicos.map((t) => t.title)).toEqual(["Meu tópico"]);
    expect(x.perfil?.bio).toBe("Estudante");
    expect(JSON.stringify(x)).not.toMatch(/password|secret|argon2/i);
  });
  it("exclui por anonimização, revoga sessões e preserva a auditoria íntegra", async () => {
    const { db, r1, c1 } = await people();
    await fr.requestFriend(db, r1, c1);
    await fr.respondFriend(db, c1, r1, true);
    await sb.postScrap(db, r1, c1, "Um recado");
    const l = await auth.login(db, { email: "aprendiz@teste.org", password: PW });
    await expect(deleteAccount(db, r1, "senha-errada-qualquer")).rejects.toThrow("senha incorreta");
    await deleteAccount(db, r1, PW);
    expect(await auth.validateSession(db, l.token)).toBeNull();
    await expect(auth.login(db, { email: "aprendiz@teste.org", password: PW })).rejects.toThrow("credenciais inválidas");
    expect((await fr.listFriends(db, c1))).toEqual([]);
    const posts = await sb.listScrap(db, c1, c1);
    expect(posts[0].authorName).toBe("Membro removido");
    expect((await verifyAuditChain(db)).ok).toBe(true);
    await expect(deleteAccount(db, r1, PW)).rejects.toThrow();
  });
  it("quem exerce cargo precisa encerrá-lo antes", async () => {
    const { db, B } = await people();
    await expect(deleteAccount(db, B.userId, "senha-de-teste-forte-1")).rejects.toThrow();
    void ctx;
  });
});
