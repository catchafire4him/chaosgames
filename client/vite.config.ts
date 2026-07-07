import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:4321",
        ws: true,
      },
      // generated art (campaign portraits/scenes) is served by the game server
      "/asset": {
        target: "http://localhost:4321",
      },
    },
  },
});
