import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
  },
  resolve: {
    alias: {
      '@ftc-sim/field': path.resolve(root, 'packages/field/src/index.ts'),
      '@ftc-sim/game-decode': path.resolve(root, 'packages/game-decode/src/index.ts'),
      '@ftc-sim/mechanisms': path.resolve(root, 'packages/mechanisms/src/index.ts'),
      '@ftc-sim/robot': path.resolve(root, 'packages/robot/src/index.ts'),
      '@ftc-sim/season-decode': path.resolve(root, 'packages/season-decode/src/index.ts'),
    },
  },
});
