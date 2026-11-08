import { z } from "zod";
import type { Rule } from "./access-control";

const status = z.enum(["regular", "debito", "licenciado", "suspenso", "eliminado", "falecido"]);
const uuidLike = z.string().min(1).max(64);

export const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("minDegree"), value: z.number().int().min(1).max(33) }).strict(),
    z.object({ kind: z.literal("lodge"), id: uuidLike }).strict(),
    z.object({ kind: z.literal("body"), id: uuidLike }).strict(),
    z.object({ kind: z.literal("jurisdiction"), id: uuidLike }).strict(),
    z.object({ kind: z.literal("office"), names: z.array(z.string().min(1).max(80)).min(1).max(10), lodgeId: uuidLike.optional(), jurisdictionId: uuidLike.optional() }).strict(),
    z.object({ kind: z.literal("status"), allowed: z.array(status).min(1) }).strict(),
    z.object({ kind: z.literal("all"), rules: z.array(ruleSchema).min(1).max(10) }).strict(),
    z.object({ kind: z.literal("any"), rules: z.array(ruleSchema).min(1).max(10) }).strict(),
  ]),
) as z.ZodType<Rule>;

const depth = (r: Rule): number => (r.kind === "all" || r.kind === "any" ? 1 + Math.max(...r.rules.map(depth)) : 1);

/** Valida a forma e limita a profundidade (evita regras patológicas). */
export function parseRule(input: unknown): Rule {
  const r = ruleSchema.parse(input);
  if (depth(r) > 5) throw new Error("regra profunda demais");
  return r;
}
