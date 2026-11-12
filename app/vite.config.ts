import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createSvgIconsPlugin } from "vite-plugin-svg-icons";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  plugins: [
    vue(),
    createSvgIconsPlugin({
      iconDirs: [path.resolve(process.cwd(), "src/assets/icons")],
      symbolId: "icon-[name]",
    }),
    viteCompression({
      verbose: true,
      disable: false,
      threshold: 10240,
      algorithm: "gzip",
      ext: ".gz",
    }),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon/**/*", "logo.png", "pwa-512.png"],
      manifest: {
        name: "柏林花园 FC · 俱乐部",
        short_name: "柏林花园 FC",
        start_url: "/club",
        display: "standalone",
        background_color: "#0b2a1d",
        theme_color: "#0b2a1d",
        icons: [
          { src: "/logo.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // 只缓存页面资源，战术内容始终通过服务读取。
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    chunkSizeWarningLimit: 1500,
    sourcemap: false,
    emptyOutDir: true,
    terserOptions: {
      compress: {
        keep_infinity: true,
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        compact: true,
        assetFileNames: "[ext]/[name]-[hash].[ext]",
        chunkFileNames: "js/[name]-[hash].js",
        entryFileNames: "js/[name]-[hash].js",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 15173,
    proxy: {
      "/api": {
        target: process.env.FOOTBALL_API_URL || "http://127.0.0.1:13001",
        // Preserve the browser host so same-origin CSRF validation also works through Vite.
        changeOrigin: false,
      },
    },
  },
});
