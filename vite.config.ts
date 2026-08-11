import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Production API (Cloudflare Worker). An explicit VITE_API_URL env var still wins;
// this default keeps the dev server and builds pointed at the deployed API.
const apiUrl = process.env.VITE_API_URL ?? "https://itp-itr-api.burinc16.workers.dev";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
  },
  resolve: {
    alias: {
      "@schema": fileURLToPath(new URL("./spec/schema/template.ts", import.meta.url)),
    },
  },
  build: { outDir: "dist" },
  preview: { allowedHosts: ["itp.full-defects.com"] },
});
