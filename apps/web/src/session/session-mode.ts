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
  const trimmed = address.trim();
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed;
  }
  return `ws://${trimmed}`;
}
