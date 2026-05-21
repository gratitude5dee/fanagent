import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reactRoot = path.resolve(__dirname, "node_modules/react");
const reactDomRoot = path.resolve(__dirname, "node_modules/react-dom");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: /^react$/, replacement: path.join(reactRoot, "index.js") },
      { find: /^react\/jsx-runtime$/, replacement: path.join(reactRoot, "jsx-runtime.js") },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.join(reactRoot, "jsx-dev-runtime.js") },
      { find: /^react-dom$/, replacement: path.join(reactDomRoot, "index.js") },
      { find: /^react-dom\/client$/, replacement: path.join(reactDomRoot, "client.js") },
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
    ],
  },

  server: {
    host: "127.0.0.1",
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  test: {
    exclude: ["tests-e2e/**", "node_modules/**", "dist/**"],
  },
});
