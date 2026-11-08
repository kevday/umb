import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000,
    env: { DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } },
});
