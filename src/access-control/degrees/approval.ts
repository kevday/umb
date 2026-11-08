import type { Decision, Subject } from "@/contracts/access-control";
import { officeActive } from "../engine/can";

export interface DegreeChange {
  targetId: string;
  targetLodgeId: string;
  fromDegree: number;
  toDegree: number;
  requestedBy: string;
}

const deny = (reason: string): Decision => ({ allow: false, reason });

/** Aprovação dupla: registrante, alvo e aprovador são pessoas distintas; aprova o Venerável Mestre ativo da Loja. */
export function canApprove(approver: Subject, ch: DegreeChange, now = new Date()): Decision {
  if (approver.technicalAdmin) return deny("administração técnica não tem autoridade maçônica");
  if (approver.id === ch.targetId) return deny("ninguém altera o próprio Grau");
  if (approver.id === ch.requestedBy) return deny("quem registra não aprova");
  if (ch.toDegree !== ch.fromDegree + 1) return deny("progressão deve ser sequencial");
  const vm = approver.offices.some(
    (o) => o.name === "Venerável Mestre" && o.lodgeId === ch.targetLodgeId && officeActive(o, now),
  );
  return vm ? { allow: true, reason: "aprovação dupla cumprida" } : deny("apenas o Venerável Mestre ativo da Loja aprova");
}
