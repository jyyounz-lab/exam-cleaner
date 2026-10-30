import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  optimizeDeps: { include: ['onnxruntime-web/wasm', 'react', 'react-dom/client', '@phosphor-icons/react'] },
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  preview: { headers: {} },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
