import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { people } from "../helpers/people";
import { ctx } from "../helpers/world";
import { withUser } from "@/shared/database/rls";
import * as inst from "@/access-control/services/institution";
import * as com from "@/core/social/communities";
import * as fr from "@/core/social/friends";
import * as sb from "@/core/social/scrapbook";
import { Forbidden, Invalid, NotFound } from "@/core/errors";

const min = (value: number) => ({ kind: "minDegree", value });

async function setup() {
  const p = await people();
  const { db, r1, c1, m1 } = p;
  await com.createCommunity(db, m1, { slug: "historia", name: "História", policy: min(1) });
  await com.createCommunity(db, m1, { slug: "simbolismo", name: "Simbolismo", policy: min(2) });
  await com.createCommunity(db, m1, { slug: "mestres", name: "Estudos de Mestres", policy: min(3) });
  await com.createCommunity(db, m1, { slug: "loja-um", name: "Avisos da Loja Um", policy: { kind: "lodge", id: p.f.lodgeId } });
  await com.createCommunity(db, m1, { slug: "so-venerais", name: "Administração", policy: { kind: "all", rules: [{ kind: "minDegree", value: 3 }, { kind: "office", names: ["Venerável Mestre"] }] } }).catch(() => null);
  return { ...p, r1, c1 };
}

describe("comunidades e invisibilidade", () => {
  it("cada Grau lista só o que pode ver", async () => {
    const { db, r1, c1, m1, o2 } = await setup();
    const names = async (u: string) => (await com.listCommunities(db, u)).map((c) => c.slug).sort();
    expect(await names(r1)).toEqual(["historia", "loja-um"]);
    expect(await names(c1)).toEqual(["historia", "loja-um", "simbolismo"]);
    expect(await names(m1)).toEqual(["historia", "loja-um", "mestres", "simbolismo"]);
    expect(await names(o2)).toEqual(["historia", "mestres", "simbolismo"]); // outra Loja não vê "loja-um"
  });
  it("acesso direto a área não autorizada é indistinguível de inexistente", async () => {
    const { db, r1 } = await setup();
    const a = await com.getCommunity(db, r1, "mestres").catch((e) => e);
    const b = await com.getCommunity(db, r1, "nao-existe").catch((e) => e);
    expect(a).toBeInstanceOf(NotFound);
    expect(b).toBeInstanceOf(NotFound);
    expect(a.message).toBe(b.message.replace("nao-existe", "mestres"));
  });
  it("busca não vaza comunidades restritas; tópicos e respostas também ficam ocultos", async () => {
    const { db, r1, m1 } = await setup();
    expect(await com.listCommunities(db, r1, "Mestres")).toEqual([]);
    const t = await com.createTopic(db, m1, "mestres", { title: "Roteiro", body: "Conteúdo restrito" });
    await expect(com.getTopic(db, r1, t.id)).rejects.toThrow(NotFound);
    await expect(com.replyTopic(db, r1, t.id, "oi")).rejects.toThrow(NotFound);
    await expect(com.createTopic(db, r1, "mestres", { title: "x", body: "y" })).rejects.toThrow(NotFound);
    const raw = await withUser(db, r1, (tx) => tx.execute(sql`select id from community_topics`));
    expect((raw as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });
  it("discussão funciona dentro do escopo e fixar é do criador", async () => {
    const { db, r1, c1, m1 } = await setup();
    const t = await com.createTopic(db, r1, "historia", { title: "Dúvida", body: "Por onde começar?" });
    await com.replyTopic(db, c1, t.id, "Comece pelas origens.");
    const got = await com.getTopic(db, m1, t.id);
    expect(got.replies).toHaveLength(1);
    await expect(com.pinTopic(db, r1, t.id, true)).rejects.toThrow(NotFound);
    await com.pinTopic(db, m1, t.id, true);
    expect((await com.getCommunity(db, r1, "historia")).topics[0].pinned).toBe(true);
  });
  it("não cria comunidade com política que o criador não satisfaz, nem política inválida", async () => {
    const { db, r1 } = await setup();
    await expect(com.createCommunity(db, r1, { slug: "acima", name: "Acima", policy: min(3) })).rejects.toThrow(Forbidden);
    await expect(com.createCommunity(db, r1, { slug: "ruim", name: "Ruim", policy: { kind: "xyz" } })).rejects.toThrow(Invalid);
    await expect(com.createCommunity(db, r1, { slug: "Sem Espaço", name: "x", policy: min(1) })).rejects.toThrow(Invalid);
  });
  it("progressão de Grau libera novas comunidades; suspensão bloqueia tudo", async () => {
    const { db, r1, A, B } = await setup();
    const slugs = async () => (await com.listCommunities(db, r1)).map((c) => c.slug);
    expect(await slugs()).not.toContain("simbolismo");
    const rq = await inst.requestDegree(db, B, r1);
    await inst.decideDegree(db, A, rq.id, true);
    expect(await slugs()).toContain("simbolismo");
    await inst.setMemberStatus(db, B, r1, "suspenso", "pendência disciplinar");
    await expect(com.listCommunities(db, r1)).rejects.toThrow(Forbidden);
    const raw = await withUser(db, r1, (tx) => tx.execute(sql`select id from communities`));
    expect((raw as unknown as { rows: unknown[] }).rows).toHaveLength(0); // o RLS também fecha
  });
});

describe("amizades e scrapbook", () => {
  it("só amigos escrevem; leitura respeita o RLS", async () => {
    const { db, r1, c1, m1 } = await setup();
    await expect(sb.postScrap(db, r1, c1, "oi")).rejects.toThrow(Forbidden);
    await fr.requestFriend(db, r1, c1);
    await expect(fr.requestFriend(db, r1, c1)).rejects.toThrow("já existe");
    await expect(fr.respondFriend(db, r1, r1, true)).rejects.toThrow(NotFound); // só o destinatário responde
    await fr.respondFriend(db, c1, r1, true);
    const post = await sb.postScrap(db, r1, c1, "Bom dia, irmão!");
    expect((await sb.listScrap(db, c1, c1)).map((p) => p.body)).toEqual(["Bom dia, irmão!"]);
    expect(await sb.listScrap(db, m1, c1)).toEqual([]); // não é amigo do dono
    await expect(sb.deleteScrap(db, m1, post.id)).rejects.toThrow(NotFound);
    await sb.deleteScrap(db, c1, post.id); // dono do perfil modera
    expect(await sb.listScrap(db, c1, c1)).toEqual([]);
    await expect(sb.postScrap(db, r1, c1, "   ")).rejects.toThrow(Invalid);
  });
  it("remover amizade corta o acesso; bloqueio não é revelado", async () => {
    const { db, r1, c1 } = await setup();
    await fr.requestFriend(db, r1, c1);
    await fr.respondFriend(db, c1, r1, true);
    expect((await fr.listFriends(db, r1)).map((f) => f.id)).toEqual([c1]);
    await fr.removeFriend(db, r1, c1);
    await expect(sb.postScrap(db, r1, c1, "oi")).rejects.toThrow(Forbidden);
    await fr.blockUser(db, c1, r1);
    await expect(fr.requestFriend(db, r1, c1)).rejects.toThrow(NotFound);
  });
});

describe("denúncias e papel do banco", () => {
  it("denuncia só o que consegue ver", async () => {
    const { db, r1, m1 } = await setup();
    const t = await com.createTopic(db, m1, "mestres", { title: "Segredo", body: "x" });
    await expect(com.reportContent(db, r1, { kind: "topic", id: t.id, reason: "teste" })).rejects.toThrow(NotFound);
    const t2 = await com.createTopic(db, m1, "historia", { title: "Aberto", body: "x" });
    await expect(com.reportContent(db, r1, { kind: "topic", id: t2.id, reason: "conteúdo impróprio" })).resolves.toBeUndefined();
  });
  it("o papel de conteúdo não toca em dados institucionais, senhas nem auditoria", async () => {
    const { db, r1 } = await setup();
    for (const q of [
      sql`select password_hash from users`,
      sql`select * from access_audit_logs`,
      sql`select * from degree_assignments`,
      sql`insert into degree_assignments (user_id, degree, requested_by, approved_by) select id, 3, id, id from users limit 1`,
      sql`update communities set policy = null`,
      sql`select * from sessions`,
    ]) await expect(withUser(db, r1, (tx) => tx.execute(q))).rejects.toThrow();
  });
});
