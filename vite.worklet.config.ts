import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The worklet is bundled separately as an IIFE. AudioWorkletGlobalScope cannot
// be relied on to resolve ES imports, so the Emscripten glue and everything
// else must be inlined into one file with no import statements left.
export default defineConfig({
  define: {
    // The glue reads import.meta.url to locate its .wasm. We hand it the bytes
    // directly instead, so the value only has to exist, not be correct.
    'import.meta.url': JSON.stringify('file:///nam-engine.worklet.js'),
  },
  build: {
    outDir: 'public',
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./src/audio/nam-engine.worklet.ts', import.meta.url)),
      formats: ['iife'],
      name: 'NamEngineWorklet',
      fileName: () => 'nam-engine.worklet.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
