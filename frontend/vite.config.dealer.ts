import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Separate build for the standalone Dealer Portal site (dealer.inventory.com).
// Ships ONLY dealer code — no admin pages. Output: dist-dealer/ (index.html).
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    outDir: "dist-dealer",
    rollupOptions: {
      input: path.resolve(__dirname, "dealer.html"),
    },
  },
});
