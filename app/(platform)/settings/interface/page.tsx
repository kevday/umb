import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/web/session";
import { getDb } from "@/web/db";
import { Flash, type SP } from "@/web/ui";
import { NOBLE_PRESETS } from "@/theme/noble";
import { getPublicLook, lookTheme } from "@/theme/site";
import { lookReset, lookSet } from "../../actions";

/** Somente a administração técnica enxerga esta página; para os demais ela não existe (404). */
export default async function InterfaceSettings({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await searchParams, p = await requirePage();
  if (!p.subject.technicalAdmin) notFound();
  const look = await getPublicLook(getDb());
  const custom = look.preset === "custom";
  const sw = (primary: string, accent: string) => {
    const t = lookTheme({ preset: "custom", primary, accent, tagline: "" });
    return (
      <svg className="swatches" width="112" height="28" role="img" aria-label="Prévia das cores">
        <rect x="0" y="0" width="34" height="28" rx="6" fill={t.light.bg} stroke={t.light.bd} />
        <rect x="38" y="0" width="34" height="28" rx="6" fill={t.light.card} stroke={t.light.bd} />
        <rect x="76" y="0" width="34" height="28" rx="6" fill={t.light.link} />
      </svg>
    );
  };
  return (
    <>
      <p><Link href="/settings">← Configurações</Link></p>
      <h1>Interface</h1>
      <p className="mut">Aparência das páginas de entrada. Visível e editável somente pela administração técnica, com 2FA.</p>
      <Flash s={s} />
      <form action={lookSet} className="card stack">
        <h3>Paleta</h3>
        {NOBLE_PRESETS.map((pr) => (
          <label key={pr.id} className="row">
            <span><input type="radio" name="preset" value={pr.id} defaultChecked={look.preset === pr.id} /> {pr.name}</span>
            {sw(pr.primary, pr.accent)}
          </label>
        ))}
        <label className="row">
          <span><input type="radio" name="preset" value="custom" defaultChecked={custom} /> Personalizada</span>
          <span className="row">
            <input name="primary" type="color" defaultValue={look.primary ?? "#0f2a5c"} aria-label="Cor de fundo" />
            <input name="accent" type="color" defaultValue={look.accent ?? "#c9a24b"} aria-label="Cor de destaque" />
          </span>
        </label>
        <label htmlFor="tagline">Frase de boas-vindas (até 120 caracteres)</label>
        <input id="tagline" name="tagline" type="text" maxLength={120} defaultValue={look.tagline} />
        <p className="mut">O sistema mantém o texto legível automaticamente, qualquer que seja a cor escolhida.</p>
        <button>Salvar</button>
      </form>
      <form action={lookReset}><button className="sec">Restaurar o padrão (azul e dourado)</button></form>
    </>
  );
}
