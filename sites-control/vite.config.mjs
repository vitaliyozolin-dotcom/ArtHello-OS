import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  server: {
    host: "0.0.0.0",
    strictPort: true,
    allowedHosts: ["terminal.local"],
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    outDir: resolve(root, ".vite-dist"),
    emptyOutDir: true,
  },
});
