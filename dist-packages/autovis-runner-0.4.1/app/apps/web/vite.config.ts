import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/artifacts": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
})
