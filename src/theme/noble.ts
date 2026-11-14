import { clamp, contrast, fit, hsl, rgbToHsl, toRgb, type Theme, type Vars } from "./palette";

export interface NoblePreset { id: string; name: string; primary: string; accent: string }

/** Paletas nobres para as páginas de entrada: fundo profundo e metal (ouro ou prata) como acento. */
export const NOBLE_PRESETS: NoblePreset[] = [
  { id: "azul-dourado", name: "Azul e dourado", primary: "#0F2A5C", accent: "#C9A24B" },
  { id: "bordo-dourado", name: "Bordô e dourado", primary: "#5E0F22", accent: "#C9A24B" },
  { id: "esmeralda-dourado", name: "Verde-esmeralda e dourado", primary: "#0B3D2E", accent: "#C9A24B" },
  { id: "violeta-dourado", name: "Violeta e dourado", primary: "#2E1A47", accent: "#C9A24B" },
  { id: "preto-dourado", name: "Preto e dourado", primary: "#141414", accent: "#D4AF37" },
  { id: "azul-prata", name: "Azul-marinho e prata", primary: "#12264A", accent: "#C0C7D1" },
];

/** Tema sempre escuro e sóbrio (igual nos modos claro e escuro), com contraste WCAG AA garantido. */
export function buildNobleTheme(primary: string, accent: string): Theme {
  const [h0, s0] = rgbToHsl(toRgb(primary));
  const h = s0 < 6 ? 220 : h0, s = clamp(s0, 20, 75);
  const bg = hsl(h, s * 0.85, 10), card = hsl(h, s * 0.75, 15), tint = hsl(h, s * 0.7, 21);
  const [ah, as, al] = rgbToHsl(toRgb(accent));
  const metal = fit(accent.toLowerCase(), card, 4.5, "lighter");
  const bd = hsl(ah, Math.min(as, 55), clamp(al * 0.55, 28, 46));
  const on = contrast("#14100a", metal) >= 4.5 ? "#14100a" : "#000000";
  const v: Vars = {
    bg, card, tint, bd, tx: fit("#f6f1e3", bg, 7, "lighter"), mut: fit(hsl(h, 14, 70), bg, 4.5, "lighter"),
    ac: metal, on, link: metal, brand: metal, decor: metal, decor2: accent.toLowerCase(), ok: "#5fcf9a", no: "#ff8a80",
  };
  return { light: v, dark: { ...v }, decor: metal, decor2: accent.toLowerCase() };
}
