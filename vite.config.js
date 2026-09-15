import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * `npm run dev` sert l'interface et relaie `/api` vers le backend scoring WFB.
 * Aucun fichier .env n'est requis.
 */
export default defineConfig({
  plugins: [react()],
  base: "/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Production source maps duplicate the frontend source and are not
    // needed by the FastAPI deployment artifact.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Empreinte dans le nom de fichier : plus de modules ES servis depuis
        // un cache navigateur périmé après un déploiement.
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8002",
        changeOrigin: true,
        // SSE : pas de mise en tampon, sinon la progression arrive d'un bloc
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if ((proxyRes.headers["content-type"] || "").includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
            }
          });
        },
      },
    },
  },
});
