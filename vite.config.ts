/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readdirSync, type Dirent } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Fails a production build if any .nam model or .wav IR is in public/, since
 * everything there is copied into the build and served. Captures from sites
 * such as TONE3000 may not be redistributed; keep local test files in
 * local-models/ instead. The dev server is left alone.
 */
function noBundledCaptures(): Plugin {
  const walk = (dir: string): string[] => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(nam|wav)$/i.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  };
  return {
    name: 'no-bundled-captures',
    apply: 'build',
    buildStart() {
      const found = walk('public');
      if (found.length > 0) {
        this.error(
          `Refusing to build: these files would be redistributed with the app:\n  ${found.join('\n  ')}\n` +
            'Move them to local-models/ (see README, Licences).',
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [
    noBundledCaptures(),
    react(),
    VitePWA({
      // Never auto-reload: a reload mid-session kills the audio stream.
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'],
      workbox: {
        // The WASM binary and the worklet bundle must be precached, or the app
        // is installable but silent offline.
        globPatterns: ['**/*.{js,css,html,wasm,woff2,png,svg,txt}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: 'Sarlifier',
        short_name: 'Sarlifier',
        description:
          "A browser-based amp & tone stack built by someone who still double-checks his pointer math.",
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        theme_color: '#1b1b1e',
        background_color: '#1b1b1e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
