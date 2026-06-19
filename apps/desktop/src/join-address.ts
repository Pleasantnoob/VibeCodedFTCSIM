import { readHostSettings } from './host-settings';
import { lanAddress } from './lan-address';
import { MATCH_PORT } from './paths';
import { isMatchServerRunning } from './match-server-child';

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

/**
 * When hosting on this PC, same-machine joins must use loopback — not LAN/public IP
 * (hairpin NAT and public IP routing break local multi-window tests).
 */
export function resolveJoinAddress(raw: string | undefined): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return `127.0.0.1:${MATCH_PORT}`;
  }

  const { host, port } = parseJoinAddress(trimmed);
  const lowerHost = host.toLowerCase();

  if (lowerHost === '127.0.0.1' || lowerHost === 'localhost' || lowerHost === '::1') {
    return `127.0.0.1:${port}`;
  }

  if (!isMatchServerRunning()) {
    return `${host}:${port}`;
  }

  const localLanHost = lanAddress(Number(port)).split(':')[0]?.toLowerCase();
  if (localLanHost && lowerHost === localLanHost) {
    return `127.0.0.1:${port}`;
  }

  const internetRaw = readHostSettings().internetAddress?.trim();
  if (internetRaw) {
    const internetHost = parseJoinAddress(internetRaw).host.toLowerCase();
    if (internetHost && lowerHost === internetHost) {
      return `127.0.0.1:${port}`;
    }
  }

  return `${host}:${port}`;
}
