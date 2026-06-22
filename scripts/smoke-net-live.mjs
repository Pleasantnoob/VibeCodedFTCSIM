#!/usr/bin/env node
/**
 * Smoke-test a running match-server on localhost:5191.
 */
const WS_URL = process.env.FTC_WS_URL ?? 'ws://127.0.0.1:5191';
const PROTOCOL = 1;

function connect(intent, displayName) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`${intent}: timeout`));
    }, 8000);

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL,
          appVersion: '1.2.3',
          displayName,
          intent,
          hostRoom: intent === 'host' ? { robotPreload: false, teamLabel: 'Host' } : undefined,
        }),
      );
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === 'welcome') {
        clearTimeout(timeout);
        resolve({ ws, welcome: msg });
        return;
      }
      if (msg.type === 'error') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`${intent}: ${msg.code} — ${msg.message}`));
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`${intent}: websocket error — is match-server running on 5191?`));
    });
  });
}

function waitFor(ws, type, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`waitFor ${type} timeout`)), ms);
    const onMessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === type) {
        clearTimeout(timeout);
        ws.removeEventListener('message', onMessage);
        resolve(msg);
      }
    };
    ws.addEventListener('message', onMessage);
  });
}

async function main() {
  console.log(`Smoke test → ${WS_URL}\n`);

  const { ws: hostWs, welcome: hostWelcome } = await connect('host', 'SmokeHost');
  console.log('✓ Host welcome', {
    role: hostWelcome.role,
    serverAppVersion: hostWelcome.serverAppVersion,
    playerId: hostWelcome.playerId,
  });

  if (hostWelcome.serverAppVersion === '1.0.0' || hostWelcome.serverAppVersion === '0.0.0') {
    console.warn('⚠ Server reports fallback version — restart match-server after latest build');
  }

  hostWs.send(
    JSON.stringify({
      type: 'set_bot_slots',
      slots: [
        { robotId: 'blue-near', enabled: true, difficulty: 'normal', runAuto: false },
        { robotId: 'red-far', enabled: true, difficulty: 'normal', runAuto: false },
        { robotId: 'red-near', enabled: true, difficulty: 'normal', runAuto: false },
      ],
    }),
  );

  hostWs.send(JSON.stringify({ type: 'claim_slot', robotId: 'player', teamLabel: '1111' }));

  const { ws: joinWs, welcome: joinWelcome } = await connect('join', 'SmokeJoin');
  console.log('✓ Join welcome', { role: joinWelcome.role, playerId: joinWelcome.playerId });

  joinWs.send(JSON.stringify({ type: 'claim_slot', robotId: 'blue-near', teamLabel: '2222' }));

  hostWs.send(JSON.stringify({ type: 'host_cmd', cmd: 'init' }));
  hostWs.send(JSON.stringify({ type: 'host_cmd', cmd: 'start_auto' }));

  let snapshot = null;
  for (let i = 0; i < 40; i++) {
    const msg = await waitFor(hostWs, 'snapshot', 3000);
    snapshot = msg;
    const robotIds = msg.robots?.map((r) => r.id) ?? [];
    if (robotIds.includes('red-far') && robotIds.includes('red-near')) break;
  }

  if (!snapshot) throw new Error('No snapshot received');

  const robotIds = snapshot.robots.map((r) => r.id).sort();
  console.log('✓ Snapshot robots:', robotIds.join(', '));
  console.log('  Artifacts:', snapshot.artifacts?.length ?? 0, '| phase:', snapshot.match?.phase);

  if (!robotIds.includes('red-far') || !robotIds.includes('red-near')) {
    throw new Error(`Bots missing from snapshot — got [${robotIds.join(', ')}]`);
  }

  hostWs.close();
  joinWs.close();
  console.log('\nAll smoke checks passed.');
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err.message);
  process.exit(1);
});
