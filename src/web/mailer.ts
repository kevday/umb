import { brand } from "@/config/brand";

export const appUrl = () => process.env.APP_URL ?? `http://${brand.domain}`;

/** Resend se RESEND_API_KEY existir; em desenvolvimento, registra no console. */
export async function sendMail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[mail:dev] para=${to} assunto="${subject}"\n${text}`);
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: brand.mailFrom, to, subject, text }),
  });
  if (!r.ok) throw new Error(`falha ao enviar e-mail (${r.status})`);
}
