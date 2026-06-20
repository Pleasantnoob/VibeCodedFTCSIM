import { MATCH_PORT } from './paths';

/** Parse host:port from a join address string. */
function parseJoinAddress(raw: string): { host: string; port: string } {
  const trimmed = raw.trim().replace(/^wss?:\/\//, '');
  const colon = trimmed.lastIndexOf(':');
  if (colon <= 0) {
    return { host: trimmed, port: String(MATCH_PORT) };
  }
  return {
    host: trimmed.slice(0, colon),
    port: trimmed.slice(colon + 1) || String(MATCH_PORT),
  };
}

/** Normalize a remote join address for the web client. */
export function resolveJoinAddress(raw: string | undefined): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new Error('Enter the host address (e.g. 192.168.1.5:5191)');
  }

  const { host, port } = parseJoinAddress(trimmed);
  const lowerHost = host.toLowerCase();

  if (lowerHost === '127.0.0.1' || lowerHost === 'localhost' || lowerHost === '::1') {
    return `127.0.0.1:${port}`;
  }

  return `${host}:${port}`;
}
