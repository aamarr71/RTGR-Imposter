import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'
import { apiDevServer } from './server/dev/vitePlugin.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
const sourceRevision = (
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? ''
).slice(0, 8)
const appVersion = sourceRevision ? `${pkg.version}+${sourceRevision}` : pkg.version

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    // Mountet dieselben API-Handler wie Vercel als Dev-Middleware unter /api.
    apiDevServer(),
    VitePWA({
      // Die App entscheidet zentral anhand des Spielzustands, wann der
      // wartende Worker aktiviert wird. Danach übernimmt er alle Clients und
      // genau ein kontrollierter Reload lädt den neuen Build.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'komm 10te',
        short_name: 'komm10te',
        description: 'Partyspiele für unterwegs: Impostor und Wer bin ich?',
        lang: 'de',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0e15',
        theme_color: '#0a0e15',
        categories: ['games', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Erst unser explizites SKIP_WAITING aktiviert einen Prompt-Worker.
        // clientsClaim erzeugt danach zuverlässig controllerchange – auch in
        // offenen Tabs und installierten PWA-Fenstern.
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Deep Links auf /room/<code> brauchen offline die App-Shell,
        // API-Aufrufe dürfen dagegen nie aus dem Cache kommen.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === '/api/terms',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'k10-terms',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Multiplayer- und Health-Daten kommen ausnahmslos vom Netz. Die
            // einzige bewusste API-Ausnahme bleibt der Terms-Offline-Cache.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') && url.pathname !== '/api/terms',
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    // In Vercel unterscheidet die bestehende Versionsanzeige damit konkrete
    // Deployments statt nur die selten geänderte package.json-Version.
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
  },
})
