/** Matemática de cor: gera paletas legíveis (WCAG) a partir de uma cor-base. Sem dependências. */
type Rgb = [number, number, number];
export const HEX = /^#[0-9a-fA-F]{6}$/;

const toRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const toHex = (c: Rgb) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}
function hslToRgb(h: number, s: number, l: number): Rgb {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const hsl = (h: number, s: number, l: number) => toHex(hslToRgb(h, Math.max(0, Math.min(100, s)), Math.max(0, Math.min(100, l))));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex: string) => { const [r, g, b] = toRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Mantém matiz e saturação e move a luminosidade até o contraste mínimo contra `against`. */
function fit(hex: string, against: string, min: number, dir: "darker" | "lighter"): string {
  const [h, s, l0] = rgbToHsl(toRgb(hex));
  let l = l0;
  for (let i = 0; i <= 100 && contrast(hsl(h, s, l), against) < min; i++) {
    l += dir === "darker" ? -1 : 1;
    if (l < 0 || l > 100) break;
  }
  return hsl(h, s, l);
}

export type Vars = Record<string, string>;
export interface Theme { light: Vars; dark: Vars; decor: string; decor2: string }

/** Constrói o tema claro e o escuro. `decor` é a cor da orla (decorativa); botões e links usam um tom ajustado para contraste. */
export function buildTheme(decor: string, decor2?: string): Theme {
  if (!HEX.test(decor)) throw new Error("cor inválida");
  const d = decor.toLowerCase(), d2 = decor2 && HEX.test(decor2) ? decor2.toLowerCase() : d;
  const [h0, s0, l0] = rgbToHsl(toRgb(d));
  const h = s0 < 8 ? 215 : h0, s = s0 < 8 ? 20 : s0;
  // Texto e botões usam a mesma cor com saturação mínima, para não ficarem acinzentados (a orla mantém a cor exata do Rito).
  const base = hsl(h, Math.max(s, 45), l0);

  const lbg = hsl(h, clamp(s, 12, 40), 94), lcard = "#ffffff";
  const link = fit(base, lbg, 4.5, "darker");
  const light: Vars = {
    bg: lbg, card: lcard, tint: hsl(h, clamp(s, 12, 45), 90), bd: hsl(h, clamp(s, 10, 30), 80),
    tx: fit(hsl(h, 35, 14), lbg, 7, "darker"), mut: fit(hsl(h, 12, 40), lbg, 4.5, "darker"),
    ac: link, on: "#ffffff", link, brand: link, decor: d, decor2: d2, ok: "#1f7a4d", no: "#b3261e",
  };
  const dbg = hsl(h, clamp(s, 15, 35), 10), dcard = hsl(h, clamp(s, 15, 30), 15);
  const dlink = fit(base, dcard, 4.5, "lighter");
  const dark: Vars = {
    bg: dbg, card: dcard, tint: hsl(h, clamp(s, 15, 30), 19), bd: hsl(h, clamp(s, 12, 28), 27),
    tx: fit(hsl(h, 20, 93), dbg, 7, "lighter"), mut: fit(hsl(h, 12, 68), dbg, 4.5, "lighter"),
    ac: dlink, on: "#0b0f1a", link: dlink, brand: dlink, decor: d, decor2: d2, ok: "#5fcf9a", no: "#ff8a80",
  };
  return { light, dark, decor: d, decor2: d2 };
}

const block = (v: Vars) => Object.entries(v).map(([k, x]) => `--${k}:${x}`).join(";");
/** CSS com variáveis. Só contém hexadecimais gerados aqui (nada vem direto do usuário). */
export const themeCss = (t: Theme) => `:root{${block(t.light)}}@media (prefers-color-scheme:dark){:root{${block(t.dark)}}}`;

export { clamp, fit, hsl, rgbToHsl, toRgb };
