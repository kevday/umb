import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "@/core/module-registry/registry";
import { demoModule } from "@/modules/demo/manifest";
import type { Subject } from "@/contracts/access-control";

const s = (degree: number): Subject => ({ id: "u", status: "regular", degree, bodyIds: [], offices: [] });

describe("Module Registry", () => {
  it("módulo inativo não aparece; ativo aparece só a quem o ACE permite", () => {
    const r = new ModuleRegistry();
    r.register(demoModule);
    expect(r.navFor(s(3))).toEqual([]);
    r.setEnabled("demo", true);
    expect(r.navFor(s(1))).toEqual([]);
    expect(r.navFor(s(2))).toEqual([{ label: "Demonstração", route: "/demo" }]);
  });
});
