export type MemberStatus = "regular" | "debito" | "licenciado" | "suspenso" | "eliminado" | "falecido";

export interface Office { name: string; lodgeId?: string; startsAt: Date; endsAt?: Date }

export interface Subject {
  id: string;
  technicalAdmin?: boolean;
  status: MemberStatus;
  degree: number; // 0 = sem Grau validado
  lodgeId?: string;
  bodyIds: string[];
  jurisdictionId?: string;
  offices: Office[];
}

export type Rule =
  | { kind: "minDegree"; value: number }
  | { kind: "lodge"; id: string }
  | { kind: "body"; id: string }
  | { kind: "jurisdiction"; id: string }
  | { kind: "office"; names: string[]; lodgeId?: string }
  | { kind: "status"; allowed: MemberStatus[] }
  | { kind: "all"; rules: Rule[] }
  | { kind: "any"; rules: Rule[] };

export interface Resource { id: string; policy: Rule | null }
export interface Decision { allow: boolean; reason: string }
