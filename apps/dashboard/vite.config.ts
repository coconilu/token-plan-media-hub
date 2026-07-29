import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4318,
    strictPort: true,
    proxy: {
      "/api":
        process.env.TP_MEDIA_DEV_GATEWAY ?? "http://127.0.0.1:4317",
    },
  },
  build: {
    sourcemap: true,
  },
});
