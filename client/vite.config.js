import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En local, l'OAuth passe aussi par le proxy : GOOGLE_REDIRECT_URI vaut
// http://localhost:5173/auth/google/callback et les cookies restent sur 5173.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
});
