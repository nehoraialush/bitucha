import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  root: "apps/web",
  plugins: [react(), tailwind()],
  server: {
    port: Number(process.env.DEV_WEB_PORT || 5173),
    proxy: { "/api": process.env.API_PROXY_TARGET || "http://127.0.0.1:3000" },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
