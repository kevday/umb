import Link from "next/link";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { loadRegistry } from "@/modules";
import { getDb } from "@/web/db";
import { requirePage } from "@/web/session";
import { resolveTheme } from "@/theme/service";
import { logoutAction } from "./actions";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const p = await requirePage();
  const db = getDb();
  const tech = !!p.subject.technicalAdmin;
  const [registry, theme] = await Promise.all([
    loadRegistry(db),
    tech ? Promise.resolve(null) : resolveTheme(db, p.session.userId),
  ]);
  const mods = registry.navFor(p.subject);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const items: [string, string][] = [
    ["/", "Início"],
    ...(tech ? [] : ([[`/profile/${p.session.userId}`, "Meu perfil"], ["/friends", "Amigos"], ["/communities", "Comunidades"]] as [string, string][])),
    ...(p.isAuthority ? ([["/institution", "Instituição"], ["/audit", "Auditoria"]] as [string, string][]) : []),
    ...mods.map((m) => [m.route, m.label] as [string, string]),
    ...(tech ? ([["/admin", "Técnico"]] as [string, string][]) : []),
    ["/settings", "Configurações"],
  ];
  return (
    <>
      {theme && theme.source !== "padrao" && <style nonce={nonce} dangerouslySetInnerHTML={{ __html: theme.css }} />}
      <header className="top">
        <div>
          <span className="brand">{brand.name}</span>
          <nav className="menu" aria-label="Principal">
            {items.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
          <form action={logoutAction}><button className="sec">Sair</button></form>
        </div>
      </header>
      <main>
        {p.isAuthority && !p.session.mfaVerified && (
          <p className="msg err" role="alert">Sua sessão ainda não confirmou o 2FA. Funções de autoridade ficam bloqueadas até você ativar ou confirmar o 2FA em <Link href="/settings">Configurações</Link>.</p>
        )}
        {children}
      </main>
    </>
  );
}
