import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // ponytail: bind 0.0.0.0 so LAN machines can reach the dev UI
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4174"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
