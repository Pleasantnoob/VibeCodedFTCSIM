import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ftc-sim-dev-url',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const addr = server.httpServer?.address();
          const port = typeof addr === 'object' && addr ? (addr as AddressInfo).port : 5190;
          console.log(`\n  FTC DECODE Simulator → http://localhost:${port}/\n`);
        });
      },
    },
  ],
  server: {
    port: 5190,
    strictPort: false,
    watch: {
      // Only ignore the large field background so edits do not full-reload the app.
      ignored: ['**/public/assets/decode.webp'],
    },
  },
  resolve: {
    alias: {
      '@ftc-sim/field': path.resolve(root, '../../packages/field/src/index.ts'),
      '@ftc-sim/game-decode': path.resolve(root, '../../packages/game-decode/src/index.ts'),
      '@ftc-sim/match': path.resolve(root, '../../packages/match/src/index.ts'),
      '@ftc-sim/mechanisms': path.resolve(root, '../../packages/mechanisms/src/index.ts'),
      '@ftc-sim/pedro': path.resolve(root, '../../packages/pedro/src/index.ts'),
      '@ftc-sim/physics': path.resolve(root, '../../packages/physics/src/index.ts'),
      '@ftc-sim/robot': path.resolve(root, '../../packages/robot/src/index.ts'),
      '@ftc-sim/season-decode': path.resolve(root, '../../packages/season-decode/src/index.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier2d-compat'],
  },
});