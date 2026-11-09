import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_ABSOLUTE, validateSession } from "@/core/auth/service";
import { officeActive } from "@/access-control/engine/can";
import { loadSubject } from "@/access-control/subject";
import { getDb } from "./db";

const prod = process.env.NODE_ENV === "production";
const NAME = prod ? "__Host-sid" : "sid";

export async function setSessionCookie(token: string) {
  (await cookies()).set(NAME, token, { httpOnly: true, secure: prod, sameSite: "lax", path: "/", maxAge: SESSION_ABSOLUTE / 1000 });
}
export async function clearSessionCookie() { (await cookies()).delete(NAME); }
export async function sessionToken() { return (await cookies()).get(NAME)?.value; }

export async function getSession() {
  const token = await sessionToken();
  if (!token) return null;
  const s = await validateSession(getDb(), token);
  return s ? { ...s, token } : null;
}

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Sessão + sujeito do ACE; sem vínculo ativo, volta ao login. */
export async function requirePage() {
  const session = await requireSession();
  const subject = await loadSubject(getDb(), session.userId);
  if (!subject) redirect("/login?e=" + encodeURIComponent("conta sem vínculo ativo"));
  const isAuthority = subject.offices.some((o) => officeActive(o, new Date()));
  return { session, subject, isAuthority, ctx: { userId: session.userId, mfaVerified: session.mfaVerified } };
}
