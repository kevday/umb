import type { Decision, MemberStatus, Resource, Rule, Subject } from "@/contracts/access-control";

const BLOCKED: MemberStatus[] = ["licenciado", "suspenso", "eliminado", "falecido"];
const deny = (reason: string): Decision => ({ allow: false, reason });
const allow = (reason: string): Decision => ({ allow: true, reason });

export const officeActive = (o: { startsAt: Date; endsAt?: Date }, now: Date) =>
  o.startsAt <= now && (!o.endsAt || o.endsAt > now);

function check(r: Rule, s: Subject, now: Date): boolean {
  switch (r.kind) {
    case "minDegree": return s.degree >= r.value;
    case "lodge": return s.lodgeId === r.id;
    case "body": return s.bodyIds.includes(r.id);
    case "jurisdiction": return s.jurisdictionId === r.id;
    case "status": return r.allowed.includes(s.status);
    case "office":
      return s.offices.some(
        (o) => r.names.includes(o.name) && officeActive(o, now) && (!r.lodgeId || o.lodgeId === r.lodgeId),
      );
    case "all": return r.rules.every((x) => check(x, s, now));
    case "any": return r.rules.some((x) => check(x, s, now));
  }
}

/** Negar por padrão. Única porta de autorização da plataforma. */
export function can(s: Subject, _action: string, res: Resource, now = new Date()): Decision {
  if (s.technicalAdmin) return deny("administração técnica não acessa conteúdo");
  if (BLOCKED.includes(s.status)) return deny(`status ${s.status}`);
  if (!res.policy) return deny("sem política explícita (negar por padrão)");
  return check(res.policy, s, now) ? allow("política atendida") : deny("política não atendida");
}

/** Invisibilidade: recurso negado é indistinguível de recurso inexistente (HTTP 404). */
export const resolve = (s: Subject, res: Resource | undefined, now?: Date): "ok" | "not_found" =>
  res && can(s, "read", res, now).allow ? "ok" : "not_found";
