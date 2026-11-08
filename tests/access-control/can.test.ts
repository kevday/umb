import { describe, expect, it } from "vitest";
import { can, resolve } from "@/access-control/engine/can";
import type { Resource, Subject } from "@/contracts/access-control";

const base: Subject = { id: "u", status: "regular", degree: 1, lodgeId: "L1", bodyIds: [], offices: [] };
const mestres: Resource = { id: "mestres", policy: { kind: "minDegree", value: 3 } };
const lojaVm: Resource = {
  id: "adm",
  policy: { kind: "all", rules: [{ kind: "lodge", id: "L1" }, { kind: "office", names: ["Venerável Mestre"], lodgeId: "L1" }] },
};

describe("ACE", () => {
  it("nega por padrão sem política", () => {
    expect(can(base, "read", { id: "x", policy: null }).allow).toBe(false);
  });
  it("respeita Grau mínimo e muda após progressão", () => {
    expect(can(base, "read", mestres).allow).toBe(false);
    expect(can({ ...base, degree: 3 }, "read", mestres).allow).toBe(true);
  });
  it("não cruza Lojas", () => {
    expect(can({ ...base, degree: 3, lodgeId: "L2" }, "read", { id: "l1", policy: { kind: "lodge", id: "L1" } }).allow).toBe(false);
  });
  it("cargo vale só dentro do mandato", () => {
    const o = { name: "Venerável Mestre", lodgeId: "L1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-12-31") };
    const vm = { ...base, offices: [o] };
    expect(can(vm, "read", lojaVm, new Date("2026-06-01")).allow).toBe(true);
    expect(can(vm, "read", lojaVm, new Date("2027-01-01")).allow).toBe(false);
  });
  it("administração técnica nunca acessa conteúdo", () => {
    expect(can({ ...base, technicalAdmin: true, degree: 33 }, "read", mestres).allow).toBe(false);
  });
  it("status suspenso bloqueia tudo", () => {
    expect(can({ ...base, degree: 3, status: "suspenso" }, "read", mestres).allow).toBe(false);
  });
  it("área negada é indistinguível de inexistente", () => {
    expect(resolve(base, mestres)).toBe("not_found");
    expect(resolve(base, undefined)).toBe("not_found");
  });
});
