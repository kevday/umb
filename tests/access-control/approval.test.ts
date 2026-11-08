import { describe, expect, it } from "vitest";
import { canApprove } from "@/access-control/degrees/approval";
import type { Subject } from "@/contracts/access-control";

const vm: Subject = {
  id: "vm", status: "regular", degree: 3, lodgeId: "L1", bodyIds: [],
  offices: [{ name: "Venerável Mestre", lodgeId: "L1", startsAt: new Date("2026-01-01") }],
};
const ch = { targetId: "r", lodgeId: "L1", fromDegree: 1, toDegree: 2, requestedBy: "sec" };

describe("progressão de Grau", () => {
  it("aprova com Venerável Mestre ativo", () => expect(canApprove(vm, ch).allow).toBe(true));
  it("registrante não aprova", () => expect(canApprove(vm, { ...ch, requestedBy: "vm" }).allow).toBe(false));
  it("ninguém altera o próprio Grau", () => expect(canApprove(vm, { ...ch, targetId: "vm" }).allow).toBe(false));
  it("administrador técnico não aprova", () => expect(canApprove({ ...vm, technicalAdmin: true }, ch).allow).toBe(false));
  it("Venerável de outra Loja não aprova", () => expect(canApprove(vm, { ...ch, lodgeId: "L2" }).allow).toBe(false));
  it("progressão deve ser sequencial", () => expect(canApprove(vm, { ...ch, toDegree: 3 }).allow).toBe(false));
});

describe("Administração da Potência", () => {
  const pot: Subject = {
    id: "pot", status: "regular", degree: 3, bodyIds: [],
    offices: [{ name: "Administração da Potência", jurisdictionId: "J1", startsAt: new Date("2026-01-01") }],
  };
  it("aprova na jurisdição da Loja", () =>
    expect(canApprove(pot, { ...ch, requestedBy: "vm", targetLodgeId: undefined as never, lodgeId: "L1", jurisdictionId: "J1" } as never).allow).toBe(true));
  it("não aprova em outra jurisdição", () =>
    expect(canApprove(pot, { ...ch, lodgeId: "L1", jurisdictionId: "J2" } as never).allow).toBe(false));
});
