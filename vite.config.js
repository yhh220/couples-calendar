import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Inject the service worker registration script into index.html automatically
      injectRegister: 'auto',
      workbox: {
        // Cache all app-shell assets
        globPatterns: ['**/*.{js,css,html,svg,ico,woff,woff2}'],
        // For navigations (SPA): always serve index.html from cache when offline
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/__/, /\/api\//],
        runtimeCaching: [
          // Cache Google Fonts stylesheets
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // Cache Google Fonts files
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Calendar',
        short_name: 'Calendar',
        description: 'Couples calendar — plans, dates, and reminders.',
        start_url: '/',
        display: 'standalone',
        background_color: '#faf8f5',
        theme_color: '#dd4f68',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
