import { notFound, redirect } from "next/navigation";
import { Forbidden, Invalid, NotFound } from "@/core/errors";

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Erros esperados voltam à página com a mensagem; qualquer outro erro sobe. */
export function back(path: string, e: unknown): never {
  if (e instanceof Invalid || e instanceof Forbidden || e instanceof NotFound) {
    const msg = e instanceof Forbidden && e.reason === "mfa_required" ? "Confirme o 2FA (em Configurações) para usar funções de autoridade." : e.message;
    redirect(`${path}${path.includes("?") ? "&" : "?"}e=${encodeURIComponent(msg)}`);
  }
  throw e;
}
export function done(path: string, msg?: string): never {
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}` : path);
}
/** Recurso negado e recurso inexistente viram o mesmo 404. */
export const orNotFound = <T,>(p: Promise<T>) => p.catch((e) => { if (e instanceof NotFound || e instanceof Forbidden) notFound(); throw e; });
