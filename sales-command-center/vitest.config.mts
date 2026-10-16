import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], fileParallelism: false },
});
