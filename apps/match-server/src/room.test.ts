import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { encodeMessage, SIM_NET_PROTOCOL_VERSION } from '@ftc-sim/net';

function waitForMessage(ws: WebSocket, type: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(String(data)) as { type: string };
        if (message.type === type) {
          clearTimeout(timer);
          resolve(message);
        }
      } catch {
        // ignore malformed frames
      }
    });
  });
}

describe('match-server room handshake', () => {
  it('accepts three join clients and sends welcome to each', async () => {
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });
    const welcomes: string[] = [];

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(String(data)) as { type: string };
        if (message.type !== 'hello') return;
        const playerId = `p${welcomes.length + 1}`;
        welcomes.push(playerId);
        ws.send(
          encodeMessage({
            type: 'welcome',
            playerId,
            role: 'player',
            roomConfig: {
              alliance: 'blue',
              barrierHash: 'test',
              artifactFriction: 0.25,
            },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const port = address.port;

    const clients = await Promise.all(
      [1, 2, 3].map(async (index) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('ws open failed'));
        });
        ws.send(
          encodeMessage({
            type: 'hello',
            protocol: SIM_NET_PROTOCOL_VERSION,
            appVersion: '0.2.0',
            displayName: `Driver${index}`,
            intent: 'join',
          }),
        );
        const welcome = (await waitForMessage(ws, 'welcome')) as { playerId: string };
        expect(welcome.playerId).toBe(`p${index}`);
        return ws;
      }),
    );

    expect(welcomes).toEqual(['p1', 'p2', 'p3']);
    for (const ws of clients) ws.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 10_000);
});
