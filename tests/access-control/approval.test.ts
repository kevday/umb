import { describe, expect, it } from "vitest";
import { canApprove } from "@/access-control/degrees/approval";
import type { Subject } from "@/contracts/access-control";

const vm: Subject = {
  id: "vm", status: "regular", degree: 3, lodgeId: "L1", bodyIds: [],
  offices: [{ name: "Venerável Mestre", lodgeId: "L1", startsAt: new Date("2026-01-01") }],
};
const ch = { targetId: "r", targetLodgeId: "L1", fromDegree: 1, toDegree: 2, requestedBy: "sec" };

describe("progressão de Grau", () => {
  it("aprova com Venerável Mestre ativo", () => expect(canApprove(vm, ch).allow).toBe(true));
  it("registrante não aprova", () => expect(canApprove(vm, { ...ch, requestedBy: "vm" }).allow).toBe(false));
  it("ninguém altera o próprio Grau", () => expect(canApprove(vm, { ...ch, targetId: "vm" }).allow).toBe(false));
  it("administrador técnico não aprova", () => expect(canApprove({ ...vm, technicalAdmin: true }, ch).allow).toBe(false));
  it("Venerável de outra Loja não aprova", () => expect(canApprove(vm, { ...ch, targetLodgeId: "L2" }).allow).toBe(false));
  it("progressão deve ser sequencial", () => expect(canApprove(vm, { ...ch, toDegree: 3 }).allow).toBe(false));
});
