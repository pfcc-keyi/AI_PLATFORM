import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api/config": "http://localhost:8001",
      "/api/ops": "http://localhost:8001",
      "/api/health": "http://localhost:8001",
      "/api/schema": "http://localhost:8001",
    },
  },
});
