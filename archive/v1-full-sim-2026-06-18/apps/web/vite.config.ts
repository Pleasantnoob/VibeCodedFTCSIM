import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
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
    open: '/',
    strictPort: false,
    watch: {
      ignored: ['**/public/assets/**'],
    },
  },
  resolve: {
    alias: {
      '@ftc-sim/core': path.resolve(root, '../../packages/core/src/index.ts'),
      '@ftc-sim/field': path.resolve(root, '../../packages/field/src/index.ts'),
      '@ftc-sim/physics': path.resolve(root, '../../packages/physics/src/index.ts'),
      '@ftc-sim/robot': path.resolve(root, '../../packages/robot/src/index.ts'),
      '@ftc-sim/pedro': path.resolve(root, '../../packages/pedro/src/index.ts'),
      '@ftc-sim/sensors': path.resolve(root, '../../packages/sensors/src/index.ts'),
      '@ftc-sim/telemetry': path.resolve(root, '../../packages/telemetry/src/index.ts'),
      '@ftc-sim/season-decode': path.resolve(root, '../../packages/season-decode/src/index.ts'),
      '@ftc-sim/game-decode': path.resolve(root, '../../packages/game-decode/src/index.ts'),
      '@ftc-sim/mechanisms': path.resolve(root, '../../packages/mechanisms/src/index.ts'),
      '@ftc-sim/input': path.resolve(root, '../../packages/input/src/index.ts'),
      '@ftc-sim/replay': path.resolve(root, '../../packages/replay/src/index.ts'),
      '@ftc-sim/analytics': path.resolve(root, '../../packages/analytics/src/index.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier2d-compat'],
  },
});
