import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Kokoro 的 onnxruntime 需要跨域隔离才能启用多线程，否则会退化为单线程（每词慢 2~3 秒）
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [vue()],
  base: '/learn-english/',
  server: {
    port: 5180,
    host: '127.0.0.1',
    open: false,
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
});
