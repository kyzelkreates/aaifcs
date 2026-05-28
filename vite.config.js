import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ============================================================
// APEX AI — Vite Config (Flat Build)
// All source files live in the project root — no subdirectories
// ============================================================

export default defineConfig({
  base: '/',

  plugins: [
    react(),
    VitePWA({
      // ── Registration strategy ──────────────────────────────
      // 'autoUpdate' = silently update SW in background,
      // then reload on next navigation. Best for fleet ops.
      registerType: 'autoUpdate',

      // ── Include our custom SW alongside the Workbox SW ────
      // This adds the background sync + push notification handler
      additionalManifestEntries: [],

      // ── Web App Manifest ───────────────────────────────────
      manifest: {
        name:             'Apex AI Fleet Control',
        short_name:       'Apex AI',
        description:      'Enterprise AI-Powered Fleet Intelligence Ecosystem',
        theme_color:      '#0a0f1e',
        background_color: '#0a0f1e',
        display:          'standalone',
        orientation:      'any',
        scope:            '/',
        start_url:        '/#/driver-app',
        categories:       ['business', 'navigation', 'productivity'],
        icons: [
          {
            src:     'icons/icon-192x192.png',
            sizes:   '192x192',
            type:    'image/png',
            purpose: 'maskable any',
          },
          {
            src:     'icons/icon-512x512.png',
            sizes:   '512x512',
            type:    'image/png',
            purpose: 'maskable any',
          },
        ],
        shortcuts: [
          {
            name:       'Driver App',
            short_name: 'Driver',
            url:        '/#/driver-app',
            description: 'Open the Driver PWA',
            icons: [{ src: 'icons/icon-192x192.png', sizes: '192x192' }],
          },
        ],
      },

      // ── Workbox config ─────────────────────────────────────
      workbox: {
        // Cache all static assets
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],

        // Remove old caches on update
        cleanupOutdatedCaches: true,


        // Runtime caching rules
        runtimeCaching: [
          // ── Supabase REST API — network-first, cache 30s ──
          {
            urlPattern: ({ url }) => url.hostname.includes('supabase.co') && url.pathname.includes('/rest/'),
            handler:    'NetworkFirst',
            options: {
              cacheName:       'supabase-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 30 },
            },
          },
          // ── Supabase Realtime — never cache (WebSocket) ───
          {
            urlPattern: ({ url }) => url.hostname.includes('supabase.co') && url.pathname.includes('/realtime/'),
            handler:    'NetworkOnly',
          },
          // ── OSM / OSRM map tiles — cache-first, 7 days ───
          {
            urlPattern: ({ url }) => url.hostname.includes('openstreetmap.org') || url.hostname.includes('osrm.org'),
            handler:    'CacheFirst',
            options: {
              cacheName:  'map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          // ── QR code API ───────────────────────────────────
          {
            urlPattern: ({ url }) => url.hostname.includes('qrserver.com'),
            handler:    'CacheFirst',
            options: {
              cacheName:  'qr-codes',
              expiration: { maxEntries: 50, maxAgeSeconds: 3600 },
            },
          },
          // ── Google Fonts ──────────────────────────────────
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler:    'CacheFirst',
            options: {
              cacheName:  'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],

        // Allow scripts to be larger (fleet app is heavy)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
      },

      // ── Dev mode ──────────────────────────────────────────
      devOptions: {
        enabled: true,
        type:    'module',
      },
    }),
  ],

  // No path aliases — everything is in root
  resolve: {
    extensions: ['.jsx', '.js', '.ts', '.tsx'],
  },

  server: {
    port: 3000,
    host: true,
  },

  build: {
    outDir:    'dist',
    sourcemap: false,
    minify:    'esbuild',
    target:    'es2020',
    rollupOptions: {
      input: 'index.html',
      output: {
        manualChunks: {
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui':       ['lucide-react', 'clsx'],
          'vendor-state':    ['zustand'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-charts':   ['recharts'],
          'vendor-leaflet':  ['leaflet', 'react-leaflet'],
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },

  optimizeDeps: {
    include: ['leaflet', 'react-leaflet', 'recharts', 'zustand', '@supabase/supabase-js'],
  },
})
