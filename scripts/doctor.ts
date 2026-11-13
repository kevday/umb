import "@/setup/load-env";
import { createDb } from "@/shared/database/client";
import { doctor } from "@/setup/steps";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL ausente (rode npm run setup)"); process.exit(1); }
const checks = await doctor(createDb(url), process.env);
const icon = { ok: "✓", warn: "!", error: "✗" } as const;
for (const c of checks) console.log(`${icon[c.level]} ${c.name}: ${c.detail}`);
const errors = checks.filter((c) => c.level === "error").length, warns = checks.filter((c) => c.level === "warn").length;
console.log(`\n${errors ? `${errors} problema(s) a corrigir` : "Tudo certo"}${warns ? `, ${warns} aviso(s)` : ""}.`);
process.exit(errors ? 1 : 0);
