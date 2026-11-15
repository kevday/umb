"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as auth from "@/core/auth/service";
import { throttle } from "@/core/auth/throttle";
import { registerWithInvitation } from "@/access-control/services/institution";
import { getDb } from "@/web/db";
import { back, done, str } from "@/web/form";
import { appUrl, sendMailSafe } from "@/web/mailer";
import { sessionToken, setSessionCookie } from "@/web/session";

const ipOf = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";

export async function loginAction(f: FormData) {
  const h = await headers();
  await throttle(getDb(), `login:${await ipOf()}`, 20, 10 * 60_000).catch((e) => back("/login", e));
  const r = await auth
    .login(getDb(), { email: str(f, "email"), password: String(f.get("password") ?? ""), ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined })
    .catch((e) => back("/login", e));
  await setSessionCookie(r.token);
  redirect(r.status === "mfa_required" ? "/login/mfa" : "/");
}

export async function mfaAction(f: FormData) {
  const token = await sessionToken();
  if (!token) redirect("/login");
  await auth.verifyMfa(getDb(), token, str(f, "code")).catch((e) => back("/login/mfa", e));
  redirect("/");
}

export async function registerAction(f: FormData) {
  const token = str(f, "token"), path = `/register?token=${encodeURIComponent(token)}`;
  await throttle(getDb(), `register:${await ipOf()}`, 10, 10 * 60_000).catch((e) => back(path, e));
  if (String(f.get("password")) !== String(f.get("password2"))) back(path, new (await import("@/core/errors")).Invalid("as senhas não conferem"));
  const email = str(f, "email");
  const r = await registerWithInvitation(getDb(), { token, email, username: str(f, "username").toLowerCase(), fullName: str(f, "fullName"), password: String(f.get("password") ?? "") }).catch((e) => back(path, e));
  const mail = await sendMailSafe(email, "Confirme seu e-mail", `Confirme seu cadastro: ${appUrl()}/verify?token=${r.verifyToken}`);
  done("/login", mail.ok || mail.skipped ? "Cadastro criado. Confirme o e-mail pelo link enviado." : "Cadastro criado, mas não foi possível enviar o e-mail de confirmação. Procure a secretaria da sua Loja.");
}

export async function verifyAction(f: FormData) {
  await auth.verifyEmail(getDb(), str(f, "token")).catch((e) => back("/login", e));
  done("/login", "E-mail confirmado. Entre para continuar.");
}

export async function forgotAction(f: FormData) {
  await throttle(getDb(), `forgot:${await ipOf()}`, 5, 10 * 60_000).catch((e) => back("/forgot", e));
  const email = str(f, "email");
  const t = await auth.requestPasswordReset(getDb(), email);
  if (t) await sendMailSafe(email, "Redefinição de senha", `Redefina sua senha (válido por 1 hora): ${appUrl()}/reset?token=${t}`);
  done("/login", "Se o e-mail estiver cadastrado, enviamos as instruções.");
}

export async function resetAction(f: FormData) {
  const token = str(f, "token");
  await auth.resetPassword(getDb(), token, String(f.get("password") ?? "")).catch((e) => back(`/reset?token=${encodeURIComponent(token)}`, e));
  done("/login", "Senha alterada. Entre com a nova senha.");
}

export async function emailConfirmAction(f: FormData) {
  const r = await auth.confirmEmailChange(getDb(), str(f, "token")).catch((e) => back("/login", e));
  await sendMailSafe(r.oldEmail, "Seu e-mail de acesso foi alterado", "O e-mail de acesso da sua conta foi alterado. Se não foi você, procure a secretaria da sua Loja imediatamente.");
  done("/login", "E-mail alterado. Entre com o novo endereço.");
}
