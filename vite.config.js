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
      registerType: 'autoUpdate',
      manifest: {
        name:             'Apex Intelligent AI Fleet Control OS',
        short_name:       'Apex AI',
        description:      'Enterprise AI-Powered Fleet Intelligence Ecosystem',
        theme_color:      '#0a0f1e',
        background_color: '#0a0f1e',
        display:          'fullscreen',
        orientation:      'any',
        scope:            '/',
        start_url:        '/',
        icons: [
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable any' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: true, type: 'module' },
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
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
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
