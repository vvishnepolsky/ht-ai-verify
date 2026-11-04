import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// One bundle serves both surfaces: the worker console at `/` and the public
// collection flow at `/flow?token=…`. The Node service serves dist/public; in
// dev, Vite proxies the API + flow + file routes to the server on :4040.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5191,
    proxy: {
      '/api': 'http://localhost:4040',
      '/flow-api': 'http://localhost:4040',
      '/hosted': 'http://localhost:4040',
      '/test-documents': 'http://localhost:4040',
    },
  },
});
