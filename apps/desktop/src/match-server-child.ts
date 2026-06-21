import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { MATCH_PORT, matchServerCwd, matchServerEntry } from './paths';

let child: ChildProcess | null = null;
let lastMatchServerStderr = '';

export function isMatchServerRunning(): boolean {
  return child !== null && child.exitCode === null;
}

export function startMatchServer(): Promise<void> {
  if (isMatchServerRunning()) {
    return Promise.resolve();
  }

  const entry = matchServerEntry();
  if (!fs.existsSync(entry)) {
    return Promise.reject(
      new Error(`Match server not found at ${entry}. Run pnpm --filter @ftc-sim/match-server build first.`),
    );
  }

  child = spawn(process.execPath, [entry], {
    cwd: matchServerCwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MATCH_PORT: String(MATCH_PORT),
      BOT_FILL_UNCLAIMED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  lastMatchServerStderr = '';
  const proc = child;
  proc.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[match-server] ${chunk.toString()}`);
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    lastMatchServerStderr = (lastMatchServerStderr + text).slice(-2000);
    process.stderr.write(`[match-server] ${text}`);
  });
  proc.on('exit', (code) => {
    child = null;
    if (code !== 0 && code !== null) {
      console.error(`[match-server] exited with code ${code}`);
    }
  });

  return waitForMatchServerReady(15_000);
}

export function stopMatchServer(): void {
  if (!child || child.exitCode !== null) {
    child = null;
    return;
  }
  child.kill();
  child = null;
}

/** Wait until the match-server TCP port accepts connections. */
export function waitForMatchServerReady(timeoutMs: number): Promise<void> {
  return waitForPort(MATCH_PORT, timeoutMs);
}

function matchServerStartError(): Error {
  const detail = lastMatchServerStderr.trim();
  if (detail) {
    const line =
      detail
        .split(/\r?\n/)
        .map((part) => part.trim())
        .find(Boolean) ?? detail;
    return new Error(`Match server failed to start: ${line}`);
  }
  return new Error('Match server did not start in time');
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (child === null || child.exitCode !== null) {
        reject(matchServerStartError());
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(matchServerStartError());
        return;
      }
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}
