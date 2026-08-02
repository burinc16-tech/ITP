import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@schema": fileURLToPath(new URL("./spec/schema/template.ts", import.meta.url)),
    },
  },
  build: { outDir: "dist" },
});
