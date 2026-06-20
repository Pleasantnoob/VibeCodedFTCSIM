export type SessionMode = 'solo' | 'host' | 'join';

export interface SessionModeConfig {
  mode: SessionMode;
  /** WebSocket address for host/join, e.g. 127.0.0.1:5191 */
  address?: string;
  displayName?: string;
}

export function getSessionModeFromUrl(): SessionModeConfig {
  if (typeof window === 'undefined') {
    return { mode: 'solo' };
  }
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'host' || mode === 'join') {
    return {
      mode,
      address: params.get('addr') ?? '127.0.0.1:5191',
      displayName: params.get('name') ?? 'Driver',
    };
  }
  return { mode: 'solo' };
}

export function buildWsUrl(address: string): string {
  const trimmed = resolveJoinAddressForBrowser(address);
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed;
  }
  return `ws://${trimmed}`;
}

/** Browser dev: same-PC joins should use loopback, not LAN IP (hairpin / fake dev addresses). */
export function resolveJoinAddressForBrowser(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return '127.0.0.1:5191';
  const normalized = trimmed.replace(/^wss?:\/\//, '');
  const colon = normalized.lastIndexOf(':');
  const host = (colon > 0 ? normalized.slice(0, colon) : normalized).toLowerCase();
  const port = colon > 0 ? normalized.slice(colon + 1) : '5191';
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return `127.0.0.1:${port || '5191'}`;
  }
  if (typeof window === 'undefined') {
    return normalized.includes(':') ? normalized : `${normalized}:5191`;
  }
  const pageHost = window.location.hostname.toLowerCase();
  const onLocalDev = pageHost === 'localhost' || pageHost === '127.0.0.1';
  const isPrivate =
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
  if (onLocalDev && isPrivate) {
    return `127.0.0.1:${port || '5191'}`;
  }
  return normalized.includes(':') ? normalized : `${normalized}:5191`;
}
