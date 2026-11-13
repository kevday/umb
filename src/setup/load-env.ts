import { existsSync } from "node:fs";

/** Carrega o .env (Node 20.12+). Variáveis já definidas no ambiente têm prioridade. Importe este módulo primeiro. */
if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch { /* arquivo inválido: o configurador avisa depois */ }
}
