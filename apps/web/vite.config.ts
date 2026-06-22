import fs from 'node:fs';

import type { AddressInfo } from 'node:net';

import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import react from '@vitejs/plugin-react';



const root = path.dirname(fileURLToPath(import.meta.url));

const desktopLauncherHtml = path.resolve(root, '../desktop/launcher.html');



const DEV_LAUNCHER_MOCK = `<script>
window.ftcLauncher = {
  getState: () =>
    Promise.resolve({
      uiPort: 5190,
      matchPort: 5191,
      lanAddress: '127.0.0.1:5191',
      matchServerRunning: false,
      internetAddress: localStorage.getItem('ftc-sim.internet-address') || '',
      publicIp: null,
      suggestedInternetAddress: '203.0.113.50:5191',
      appVersion: '1.2.2',
    }),
  onState: () => () => {},
  onUpdateAvailable: () => () => {},
  onUpdateProgress: () => () => {},
  onUpdateCheckResult: () => () => {},
  openSolo: () => {
    window.open('/', '_blank');
    return Promise.resolve();
  },
  openHost: () => {
    window.open('/?mode=host&addr=127.0.0.1:5191&name=Driver', '_blank');
    return Promise.resolve({
      lanAddress: '127.0.0.1:5191',
      inviteAddress: '203.0.113.50:5191',
      notes: ['Dev — run pnpm dev:server · same-PC join uses 127.0.0.1:5191'],
    });
  },
  hostOnline: () => {
    window.open('/?mode=host&addr=127.0.0.1:5191&name=Driver', '_blank');
    return Promise.resolve({
      lanAddress: '127.0.0.1:5191',
      inviteAddress: '203.0.113.50:5191',
      notes: ['Dev preview — public invite copied'],
    });
  },
  writeClipboard: async (text) => {
    const value = String(text ?? '').trim();
    if (!value) throw new Error('Nothing to copy');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch {
      /* use fallback below */
    }
    const el = document.createElement('textarea');
    el.value = value;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (!ok) throw new Error('Could not copy to clipboard');
  },
  openJoin: (address) => {
    const addr = encodeURIComponent(String(address || '127.0.0.1:5191'));
    window.open('/?mode=join&addr=' + addr + '&name=Driver', '_blank');
    return Promise.resolve();
  },
  checkForUpdates: () =>
    Promise.resolve({
      status: 'current',
      current: '1.2.2',
    }),
  copyLan: () => Promise.resolve('127.0.0.1:5191'),
  copyInternet: (address) => {
    const typed = String(address ?? '').trim();
    if (typed) return Promise.resolve(typed);
    return Promise.resolve(localStorage.getItem('ftc-sim.internet-address') || '');
  },
  saveInternet: (address) => {
    const trimmed = String(address || '').trim();
    if (trimmed) localStorage.setItem('ftc-sim.internet-address', trimmed);
    else localStorage.removeItem('ftc-sim.internet-address');
    return Promise.resolve(trimmed);
  },
  detectPublicIp: () => Promise.resolve({ publicIp: null, suggestedInternetAddress: null }),
  openInternetGuide: () => {
    window.open('https://github.com/Pleasantnoob/VibeCodedFTCSIM/blob/main/docs/INTERNET_PLAY.md', '_blank');
    return Promise.resolve();
  },
  stopServer: () => Promise.resolve(),
  openReleasePage: () => Promise.resolve(),
  downloadUpdate: () => Promise.resolve({ ok: false, error: 'Updates only in desktop build' }),
};
</script>`;



export default defineConfig({

  define: {

    __APP_VERSION__: JSON.stringify('1.2.2'),

  },

  plugins: [

    react(),

    {

      name: 'ftc-sim-dev-url',

      configureServer(server) {

        server.middlewares.use((req, res, next) => {

          const url = req.url?.split('?')[0] ?? '';

          if (url !== '/launcher' && url !== '/launcher/') {

            next();

            return;

          }

          try {

            const html = fs.readFileSync(desktopLauncherHtml, 'utf8');

            const injected = html.replace(

              '<script>',

              `${DEV_LAUNCHER_MOCK}\n    <script>`,

            );

            res.setHeader('Content-Type', 'text/html; charset=utf-8');

            res.end(injected);

          } catch (err) {

            res.statusCode = 500;

            res.end(`Failed to load launcher: ${err instanceof Error ? err.message : String(err)}`);

          }

        });



        server.httpServer?.once('listening', () => {

          const addr = server.httpServer?.address();

          const port = typeof addr === 'object' && addr ? (addr as AddressInfo).port : 5190;

          console.log(`\n  FTC DECODE Simulator → http://localhost:${port}/`);

          console.log(`  Electron launcher (dev) → http://localhost:${port}/launcher`);

          console.log(`  Host UI → http://localhost:${port}/?mode=host&addr=127.0.0.1:5191`);

          console.log(`  Join UI → http://localhost:${port}/?mode=join&addr=127.0.0.1:5191`);

          console.log(`  (Spectator: join without picking a robot slot)\n`);

        });

      },

    },

  ],

  server: {

    port: 5190,

    strictPort: true,

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

      '@ftc-sim/session': path.resolve(root, '../../packages/session/src/index.ts'),

      '@ftc-sim/bot': path.resolve(root, '../../packages/bot/src/index.ts'),

    },

  },

  optimizeDeps: {

    exclude: ['@dimforge/rapier2d-compat'],

  },

});

