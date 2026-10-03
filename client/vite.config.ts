import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_URL || "http://localhost:3001";
const wsTarget = process.env.VITE_WS_URL || "ws://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": apiTarget,
      "/ws": {
        target: wsTarget,
        ws: true,
      },
    },
  },
});
