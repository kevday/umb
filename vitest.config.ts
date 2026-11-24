import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const p = (d: string) => fileURLToPath(new URL(d, import.meta.url));
const real = !!process.env.TEST_DATABASE_URL; // com PostgreSQL real, os arquivos rodam em série (mesmo banco)
export default defineConfig({
  resolve: { alias: { "@kernel": p("./kernel"), "@modules": p("./modules") } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000, hookTimeout: 120000, fileParallelism: !real, env: { DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } },
});
