import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import "./globals.css";

export const metadata = { title: brand.name, robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
