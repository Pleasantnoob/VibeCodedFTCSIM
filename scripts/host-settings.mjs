import fs from 'node:fs';
import os from 'node:os';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const MATCH_PORT = 5191;

let cachedPublicIp = null;
let cachedPublicIpAt = 0;
const PUBLIC_IP_CACHE_MS = 5 * 60 * 1000;

function settingsPath() {
  return path.join(os.homedir(), '.ftc-sim', 'host-settings.json');
}

export function readHostSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    const internetAddress = String(parsed.internetAddress ?? parsed.playitAddress ?? '').trim();
    return { internetAddress };
  } catch {
    return { internetAddress: '' };
  }
}

export function writeHostSettings(settings) {
  const next = { internetAddress: String(settings.internetAddress ?? settings.playitAddress ?? '').trim() };
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

export function lanAddress(port = MATCH_PORT) {
  for (const entries of Object.values(networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) return `${entry.address}:${port}`;
    }
  }
  return `127.0.0.1:${port}`;
}

export async function fetchPublicIp() {
  if (cachedPublicIp && Date.now() - cachedPublicIpAt < PUBLIC_IP_CACHE_MS) {
    return cachedPublicIp;
  }
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const ip = String(data.ip ?? '').trim();
    if (!ip) return null;
    cachedPublicIp = ip;
    cachedPublicIpAt = Date.now();
    return ip;
  } catch {
    return null;
  }
}

export async function hostInfoPayload(matchPort = MATCH_PORT) {
  const settings = readHostSettings();
  const publicIp = await fetchPublicIp();
  const suggestedInternetAddress = publicIp ? `${publicIp}:${matchPort}` : null;
  return {
    matchPort,
    lanAddress: lanAddress(matchPort),
    publicIp,
    suggestedInternetAddress,
    internetAddress: settings.internetAddress,
    playitAddress: settings.internetAddress,
  };
}

export async function handleHostSettingsApi(req, res, urlPath) {
  if (urlPath === '/api/host-info') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(await hostInfoPayload()));
    return true;
  }

  if (urlPath !== '/api/host-settings') return false;

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(await hostInfoPayload()));
    return true;
  }

  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const saved = writeHostSettings({
        internetAddress: body.internetAddress ?? body.playitAddress ?? '',
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          internetAddress: saved.internetAddress,
          playitAddress: saved.internetAddress,
          ok: true,
        }),
      );
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
    return true;
  }

  res.writeHead(405);
  res.end();
  return true;
}
