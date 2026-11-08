import type { ModuleManifest } from "@/core/module-registry/registry";

export const demoModule: ModuleManifest = {
  id: "demo",
  name: "Módulo de demonstração",
  version: "0.1.0",
  coreApi: "^1.0.0",
  permissions: ["demo.read"],
  nav: [{ label: "Demonstração", route: "/demo", resource: { id: "demo", policy: { kind: "minDegree", value: 2 } } }],
};
