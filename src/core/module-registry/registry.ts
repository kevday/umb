import type { Resource, Subject } from "@/contracts/access-control";
import { can } from "@/access-control/engine/can";

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  coreApi: string;
  permissions: string[];
  nav: { label: string; route: string; resource: Resource }[];
}

/** O manifesto vive no código; o banco guarda só o estado (ativo/inativo). */
export class ModuleRegistry {
  private mods = new Map<string, { m: ModuleManifest; enabled: boolean }>();
  register(m: ModuleManifest, enabled = false) { this.mods.set(m.id, { m, enabled }); }
  setEnabled(id: string, enabled: boolean) {
    const x = this.mods.get(id);
    if (!x) throw new Error(`módulo desconhecido: ${id}`);
    x.enabled = enabled;
  }
  list() { return [...this.mods.values()].map((x) => ({ ...x.m, enabled: x.enabled })); }
  /** Navegação gerada só com o que o ACE permite; nada de itens que revelem áreas restritas. */
  navFor(s: Subject) {
    return [...this.mods.values()]
      .filter((x) => x.enabled)
      .flatMap((x) => x.m.nav.filter((n) => can(s, "read", n.resource).allow).map(({ label, route }) => ({ label, route })));
  }
}
