import type { IncomingMessage, ServerResponse } from 'node:http';
import { prepareInternetHost } from './internet-host';
import { lanAddress } from './lan-address';
import { readHostSettings, writeHostSettings } from './host-settings';
import { fetchPublicIp, suggestedInternetAddress } from './public-ip';
import { MATCH_PORT } from './paths';

function readBody(req: IncomingMessage, maxBytes = 65_536): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseInternetAddress(body: { internetAddress?: string; playitAddress?: string }): string {
  return String(body.internetAddress ?? body.playitAddress ?? '').trim();
}

async function hostInfoPayload() {
  const settings = readHostSettings();
  const publicIp = await fetchPublicIp();
  const suggested = suggestedInternetAddress(publicIp, MATCH_PORT);
  return {
    matchPort: MATCH_PORT,
    lanAddress: lanAddress(MATCH_PORT),
    publicIp,
    suggestedInternetAddress: suggested,
    internetAddress: settings.internetAddress,
    // Legacy field for older web bundles
    playitAddress: settings.internetAddress,
  };
}

export async function handleHostSettingsApi(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
): Promise<boolean> {
  if (urlPath === '/api/prepare-internet-host') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return true;
    }
    const result = await prepareInternetHost(MATCH_PORT);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, ...result }));
    return true;
  }

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
    try {
      const body = JSON.parse(await readBody(req)) as {
        internetAddress?: string;
        playitAddress?: string;
      };
      const saved = writeHostSettings({ internetAddress: parseInternetAddress(body) });
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
