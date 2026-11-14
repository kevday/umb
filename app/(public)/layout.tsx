import type { ReactNode } from "react";
import { headers } from "next/headers";
import { brand } from "@/config/brand";
import { themeCss } from "@/theme/palette";
import { DEFAULT_LOOK, getPublicLook, lookTheme } from "@/theme/site";
import { getDb } from "@/web/db";

/** Páginas de entrada: paleta nobre definida pela administração técnica (padrão: azul e dourado). */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  let look = DEFAULT_LOOK;
  try { look = await getPublicLook(getDb()); } catch { /* sem banco: usa o padrão */ }
  return (
    <>
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: themeCss(lookTheme(look)) }} />
      <div className="noble">
        <header className="noble-head">
          <span className="noble-brand">{brand.name}</span>
          <span className="noble-tag">{look.tagline}</span>
        </header>
        {children}
      </div>
    </>
  );
}
