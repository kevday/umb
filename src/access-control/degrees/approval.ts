import type { Decision, Subject } from "@/contracts/access-control";
import { BLOCKED, officeActive } from "../engine/can";

export const POTENCIA = "Administração da Potência";
export const VM = "Venerável Mestre";

export interface ApprovalContext {
  lodgeId: string;
  jurisdictionId?: string;
  requestedBy: string;
  targetId?: string;
}
export interface DegreeChange extends ApprovalContext {
  targetId: string;
  fromDegree: number;
  toDegree: number;
}

const deny = (reason: string): Decision => ({ allow: false, reason });

/**
 * Aprovação dupla: registrante, alvo e aprovador são pessoas distintas.
 * Aprova o Venerável Mestre ativo da Loja ou a Administração da Potência da jurisdição da Loja.
 */
export function canApproveInLodge(approver: Subject, ctx: ApprovalContext, now = new Date()): Decision {
  if (approver.technicalAdmin) return deny("administração técnica não tem autoridade maçônica");
  if (BLOCKED.includes(approver.status)) return deny(`status ${approver.status}`);
  if (ctx.targetId && approver.id === ctx.targetId) return deny("ninguém altera a própria condição");
  if (approver.id === ctx.requestedBy) return deny("quem registra não aprova");
  const ok = approver.offices.some(
    (o) =>
      officeActive(o, now) &&
      ((o.name === VM && o.lodgeId === ctx.lodgeId) ||
        (o.name === POTENCIA && !!ctx.jurisdictionId && o.jurisdictionId === ctx.jurisdictionId)),
  );
  return ok
    ? { allow: true, reason: "aprovação dupla cumprida" }
    : deny("apenas o Venerável Mestre ativo da Loja ou a Administração da Potência aprovam");
}

export function canApprove(approver: Subject, ch: DegreeChange, now = new Date()): Decision {
  if (approver.id === ch.targetId) return deny("ninguém altera o próprio Grau");
  if (ch.toDegree !== ch.fromDegree + 1) return deny("progressão deve ser sequencial");
  return canApproveInLodge(approver, ch, now);
}
