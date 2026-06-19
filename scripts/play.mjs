#!/usr/bin/env node
/**
 * Lightweight launcher (same flow as apps/desktop, no Electron required).
 *
 *   pnpm play          → start servers, open browser menu
 *   pnpm play:solo     → solo only
 *   pnpm play:host     → host + match server
 *   pnpm play:join     → join flow
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleHostSettingsApi, hostInfoPayload, lanAddress } from './host-settings.mjs';

const UI_PORT = 5190;
const MATCH_PORT = 5191;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'apps/desktop/resources/web');
const serverEntry = path.join(root, 'apps/desktop/resources/match-server/dist/index.js');
const serverCwd = path.join(root, 'apps/desktop/resources/match-server');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const LAUNCHER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FTC Sim — Choose mode</title>
  <style>
    body { font-family: Segoe UI, system-ui, sans-serif; background: #0f1419; color: #e8eef5; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #151c24; border: 1px solid #243041; border-radius: 16px; padding: 32px; max-width: 420px; width: 90%; }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    p { color: #9fb0c3; margin: 0 0 24px; line-height: 1.5; }
    button { display: block; width: 100%; margin: 10px 0; padding: 14px 16px; border: none; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; text-align: left; }
    .primary { background: #2d6cdf; color: white; }
    .secondary { background: #1c2430; color: #e8eef5; border: 1px solid #334155; }
    button small { display: block; font-weight: 400; opacity: 0.85; margin-top: 4px; font-size: 0.82rem; }
    .panel { margin-top: 20px; padding-top: 16px; border-top: 1px solid #243041; }
    .addr { font-family: Consolas, monospace; color: #7dd3fc; margin: 8px 0; }
    input.addr { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #334155; background: #0f1419; color: #7dd3fc; font-family: Consolas, monospace; }
    .row { display: flex; gap: 8px; margin-top: 8px; }
    .row button { flex: 1; margin: 0; text-align: center; padding: 10px; font-size: 0.9rem; }
    .hint { font-size: 0.85rem; color: #9fb0c3; margin: 0 0 8px; }
    .status { margin-top: 16px; font-size: 0.9rem; color: #86efac; min-height: 1.2em; }
    .err { color: #fca5a5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>FTC Sim</h1>
    <p>Pick a mode. Internet friends need your <strong>public IP:5191</strong> (port forward — see below).</p>
    <button class="primary" onclick="go('solo')">Play Solo<small>Practice alone on this PC</small></button>
    <button class="secondary" onclick="go('host')">Host Match<small>Start server + open as host</small></button>
    <button class="secondary" onclick="go('join')">Join Match<small>Connect to someone else's host</small></button>
    <div class="panel">
      <p class="hint"><strong>LAN</strong> (same Wi‑Fi)</p>
      <div class="addr" id="lan">…</div>
    </div>
    <div class="panel">
      <p class="hint"><strong>Internet</strong> — forward TCP 5191 on your router</p>
      <input class="addr" id="internet" placeholder="73.x.x.x:5191" />
      <div class="row">
        <button class="secondary" onclick="detectIp()">Detect IP</button>
        <button class="secondary" onclick="saveInternet()">Save</button>
        <button class="secondary" onclick="copyInternet()">Copy</button>
        <button class="secondary" onclick="window.open('https://github.com/Pleasantnoob/VibeCodedFTCSIM/blob/main/docs/INTERNET_PLAY.md')">Guide</button>
      </div>
    </div>
    <div class="status" id="status"></div>
  </div>
  <script>
    async function loadSettings() {
      try {
        const res = await fetch('/api/host-info');
        const data = await res.json();
        document.getElementById('lan').textContent = data.lanAddress || '…';
        const input = document.getElementById('internet');
        if (data.internetAddress) input.value = data.internetAddress;
        else if (data.suggestedInternetAddress) input.value = data.suggestedInternetAddress;
        if (data.publicIp) document.getElementById('status').textContent = 'Public IP: ' + data.publicIp;
      } catch (_) {}
    }
    loadSettings();
    async function detectIp() {
      const res = await fetch('/api/host-info');
      const data = await res.json();
      if (data.suggestedInternetAddress) {
        document.getElementById('internet').value = data.suggestedInternetAddress;
        document.getElementById('status').textContent = 'Detected ' + data.suggestedInternetAddress;
      }
    }
    async function saveInternet() {
      const internetAddress = document.getElementById('internet').value.trim();
      await fetch('/api/host-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internetAddress }),
      });
      document.getElementById('status').textContent = 'Saved internet address';
    }
    async function copyInternet() {
      const v = document.getElementById('internet').value.trim();
      if (v) await navigator.clipboard.writeText(v);
      document.getElementById('status').textContent = v ? 'Copied ' + v : 'Enter public IP:5191 first';
    }
    async function go(mode) {
      const el = document.getElementById('status');
      el.className = 'status';
      if (mode === 'host') {
        el.textContent = 'Starting match server…';
        try {
          const res = await fetch('/api/start-host', { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          el.textContent = 'Share with friends: ' + data.lan;
        } catch (e) {
          el.className = 'status err';
          el.textContent = e.message;
          return;
        }
      }
      const q = mode === 'solo' ? '' : '?mode=' + mode + '&addr=127.0.0.1:5191&name=Driver';
      location.href = '/' + q;
    }
  </script>
</body>
</html>`;

let matchChild = null;
let httpServer = null;

function startMatchServer() {
  if (matchChild && matchChild.exitCode === null) return Promise.resolve();
  if (!fs.existsSync(serverEntry)) {
    return Promise.reject(new Error('Missing match-server. Run: pnpm --filter @ftc-sim/desktop prepare:resources'));
  }
  matchChild = spawn(process.execPath, [serverEntry], {
    cwd: serverCwd,
    env: { ...process.env, MATCH_PORT: String(MATCH_PORT) },
    stdio: 'inherit',
  });
  matchChild.on('exit', () => {
    matchChild = null;
  });
  return waitForPort(MATCH_PORT);
}

function waitForPort(port, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Match server did not start'));
        return;
      }
      import('node:net').then(({ connect }) => {
        const socket = connect({ port, host: '127.0.0.1' });
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', () => {
          socket.destroy();
          setTimeout(tick, 200);
        });
      });
    };
    tick();
  });
}

function openBrowser(path = '/launcher.html') {
  const url = `http://127.0.0.1:${UI_PORT}${path}`;
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  console.log(`  Opened ${url}`);
}

function startStaticServer() {
  if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
    throw new Error('Missing web bundle. Run: pnpm --filter @ftc-sim/desktop prepare:resources');
  }
  return new Promise((resolve, reject) => {
    httpServer = createServer(async (req, res) => {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');

      if (urlPath === '/launcher.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(LAUNCHER_HTML);
        return;
      }

      if (await handleHostSettingsApi(req, res, urlPath)) {
        return;
      }

      if (urlPath === '/api/launcher-info' && req.method === 'GET') {
        const info = await hostInfoPayload(MATCH_PORT);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ...info,
            matchServerRunning: matchChild && matchChild.exitCode === null,
          }),
        );
        return;
      }

      if (urlPath === '/api/start-host' && req.method === 'POST') {
        try {
          await startMatchServer();
          const lan = lanAddress(MATCH_PORT);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, lan }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      let filePath = path.join(webRoot, urlPath === '/' ? 'index.html' : urlPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) filePath = path.join(webRoot, 'index.html');
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    });
    httpServer.once('error', reject);
    httpServer.listen(UI_PORT, '127.0.0.1', () => resolve(httpServer));
  });
}

async function runMode(mode) {
  await startStaticServer();
  console.log(`\n  FTC Sim running at http://127.0.0.1:${UI_PORT}/`);
  console.log(`  LAN address (for friends): ${lanAddress(MATCH_PORT)}\n`);

  if (mode === 'solo') {
    openBrowser('/');
  } else if (mode === 'host') {
    await startMatchServer();
    console.log(`  Match server running. Share: ${lanAddress(MATCH_PORT)}`);
    openBrowser('/?mode=host&addr=127.0.0.1:5191&name=Driver');
  } else if (mode === 'join') {
    openBrowser('/?mode=join&addr=127.0.0.1:5191&name=Driver');
  } else {
    openBrowser('/launcher.html');
  }

  console.log('  Press Ctrl+C to stop.\n');
}

function cleanup() {
  matchChild?.kill();
  matchChild = null;
  httpServer?.close();
}

const modeArg = process.argv[2]?.toLowerCase();
const mode =
  modeArg === '1' || modeArg === 'solo'
    ? 'solo'
    : modeArg === '2' || modeArg === 'host'
      ? 'host'
      : modeArg === '3' || modeArg === 'join'
        ? 'join'
        : modeArg || 'menu';

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

try {
  await runMode(mode);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  cleanup();
  process.exit(1);
}
