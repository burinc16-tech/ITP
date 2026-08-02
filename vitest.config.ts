import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@schema": fileURLToPath(new URL("./spec/schema/template.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./web/src/test-setup.ts"],
    include: ["spec/**/*.test.ts", "web/**/*.test.{ts,tsx}", "api/**/*.test.ts"],
  },
});
