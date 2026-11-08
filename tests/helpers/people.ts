import { world, ctx } from "./world";
import * as inst from "@/access-control/services/institution";

const past = new Date("2026-01-01");

/** Mundo com duas Lojas e membros de vários Graus, para testes de visibilidade. */
export async function people() {
  const w = await world();
  const { db, f, A, B, member } = w;
  const r1 = await member({ name: "aprendiz", degree: 1 });
  const c1 = await member({ name: "companheiro", degree: 2 });
  const m1 = await member({ name: "mestre", degree: 3 });
  const pot2 = await member({ name: "potdois", degree: 3 });
  await inst.appointOffice(db, A, { userId: pot2, name: "Administração da Potência", jurisdictionId: f.jurisdictionId, startsAt: past });
  const l2 = await inst.createLodge(db, A, { jurisdictionId: f.jurisdictionId, name: "Loja Dois", number: 2 });
  const o2 = await member({ name: "outraloja", degree: 3, lodgeId: l2.id, inviter: A, approver: ctx(pot2) });
  return { ...w, r1, c1, m1, pot2, l2, o2, B, A };
}
