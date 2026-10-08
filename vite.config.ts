import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { singleFile } from "./checks/single-file-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), singleFile()],
  base: "./",
  build: {
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // the sandbox preview proxies the dev server under an external host
    allowedHosts: [".e2b.app"],
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: [".e2b.app"],
  },
});
