import { buildTheme, type Theme } from "./palette";

export interface Rite { id: string; name: string; decor: string; decor2?: string; note: string }

/** Cores predominantes do avental de Mestre (orla e adornos) de cada Rito. */
export const RITES: Rite[] = [
  { id: "reaa", name: "Rito Escocês Antigo e Aceito (REAA)", decor: "#B22222", decor2: "#DC143C", note: "Vermelho carmesim: orla, forro e letras M∴B∴." },
  { id: "rer", name: "Rito Escocês Retificado (RER)", decor: "#4682B4", decor2: "#1F3A5F", note: "Azul-celeste com filete interno azul-escuro." },
  { id: "schroder", name: "Rito Schröder", decor: "#87CEFA", decor2: "#5B8DB8", note: "Orla azul-clara estreita sobre base branca." },
  { id: "york", name: "Rito de York", decor: "#7BAFD4", decor2: "#6495ED", note: "Azul-celeste (Cambridge blue) com três rosetas." },
  { id: "emulacao", name: "Rito Inglês, Estilo Emulação", decor: "#008B8B", decor2: "#C0C0C0", note: "Azul-turmalina com borlas prateadas." },
  { id: "frances", name: "Rito Francês (Moderno)", decor: "#5D8AA8", decor2: "#00BFFF", note: "Azul-celeste com M∴B∴ ao centro." },
  { id: "adonhiramita", name: "Rito Adonhiramita (azul)", decor: "#1E90FF", decor2: "#5D8AA8", note: "Orla e rosetas em azul-celeste." },
  { id: "adonhiramita-vermelho", name: "Rito Adonhiramita (vermelho)", decor: "#C8102E", decor2: "#8E0B21", note: "Variação tradicional em vermelho." },
  { id: "brasileiro", name: "Rito Brasileiro", decor: "#002366", decor2: "#D4AF37", note: "Azul royal com bordados dourados (acácia)." },
  { id: "memphis", name: "Antigo e Primitivo de Memphis-Misraïm", decor: "#00BFFF", decor2: "#D4AF37", note: "Base branca, orla celeste ou turquesa e bordados dourados." },
];
export const RITE_IDS = RITES.map((r) => r.id);
export const findRite = (id?: string | null) => RITES.find((r) => r.id === id);

/** Padrão (sem Rito): azul-lavanda suave com acento magenta, em estilo de rede social clássica. */
function buildDefault(): Theme {
  const t = buildTheme("#3B5BA9", "#E0457B");
  return {
    ...t,
    light: { ...t.light, bg: "#dce5f9", tint: "#eaf0fd", bd: "#b8c7ea", brand: "#b0155a", decor: "#8fa8e3", decor2: "#e0457b" },
    dark: { ...t.dark, brand: "#ff7fb0", decor: "#6f8bd6", decor2: "#e0457b" },
    decor: "#8fa8e3", decor2: "#e0457b",
  };
}
export const DEFAULT_THEME: Theme = buildDefault();
export const themeForRite = (id?: string | null): Theme => { const r = findRite(id); return r ? buildTheme(r.decor, r.decor2) : DEFAULT_THEME; };
