/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Black Notebook',
        short_name: 'Notebook',
        description: 'A 90-day self-review notebook with Saakshi, a reviewer that only trusts evidence.',
        theme_color: '#0b0b0b',
        background_color: '#0b0b0b',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg}']
      },
      devOptions: { enabled: false }
    })
  ],
  test: {
    environment: 'node'
  }
});
