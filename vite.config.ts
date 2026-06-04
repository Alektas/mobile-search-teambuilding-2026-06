import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "mobile-search-teambuilding-2026-04";

export default defineConfig({
  base: process.env.GITHUB_REPOSITORY ? `/${repoName}/` : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-icon.svg"],
      manifest: {
        name: "Расписание командировки",
        short_name: "Расписание",
        description: "Мобильное расписание командировки",
        theme_color: "#f8fafc",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait",
        lang: "ru",
        icons: [
          {
            src: "pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{html,js,css,svg,png,ico,json,webmanifest}"],
        navigateFallbackDenylist: [/^\/assets\//]
      }
    })
  ]
});

