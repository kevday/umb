import type { ReactNode } from "react";
import { headers } from "next/headers";
import { brand } from "@/config/brand";
import { defaultThemeCss } from "@/theme/css";
import "./globals.css";

export const metadata = { title: brand.name, robots: { index: false, follow: false } };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="pt-BR">
      <head><style nonce={nonce} dangerouslySetInnerHTML={{ __html: defaultThemeCss() }} /></head>
      <body>{children}</body>
    </html>
  );
}
