import { useState } from 'react';
import type { SessionMode } from './session-mode';
import './lobby.css';

export interface LobbyScreenProps {
  initialMode: SessionMode;
  initialAddress: string;
  initialName: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  role: 'host' | 'player' | 'spectator' | null;
  lanAddress: string | null;
  rttMs: number | null;
  matchPhase: string | null;
  onChooseSolo: () => void;
  onConnect: (mode: 'host' | 'join', address: string, name: string) => void;
  onDisconnect: () => void;
}

export function LobbyScreen({
  initialMode,
  initialAddress,
  initialName,
  connected,
  connecting,
  error,
  role,
  lanAddress,
  rttMs,
  matchPhase,
  onChooseSolo,
  onConnect,
  onDisconnect,
}: LobbyScreenProps) {
  const [mode, setMode] = useState<'solo' | 'host' | 'join'>(initialMode === 'solo' ? 'solo' : initialMode);
  const [address, setAddress] = useState(initialAddress);
  const [name, setName] = useState(initialName);
  const [collapsed, setCollapsed] = useState(initialMode === 'solo' && !connected);

  if (collapsed) {
    const label = connected
      ? role === 'host'
        ? 'Host connected'
        : 'Joined'
      : 'Multiplayer';
    return (
      <button type="button" className={`lobby-fab${connected ? ' lobby-fab--live' : ''}`} onClick={() => setCollapsed(false)}>
        <span className="lobby-fab__dot" aria-hidden />
        {label}
      </button>
    );
  }

  const statusLine = connecting
    ? 'Connecting…'
    : connected
      ? role === 'host'
        ? `Connected as host · match: ${matchPhase ?? 'setup'}`
        : `Connected as ${role ?? 'player'} · spectating`
      : 'Not connected';

  return (
    <div className="lobby-panel">
      <div className="lobby-panel__header">
        <strong>Multiplayer</strong>
        <button type="button" className="lobby-panel__close" onClick={() => setCollapsed(true)} aria-label="Close">
          Close
        </button>
      </div>

      <p className={`lobby-panel__status${connected ? ' lobby-panel__status--live' : ''}`}>{statusLine}</p>

      {connected && role === 'host' && matchPhase === 'setup' && (
        <p className="lobby-panel__hint lobby-panel__hint--warn">
          Press <strong>INF</strong> in the toolbar to start driving (infinite teleop).
        </p>
      )}

      {connected && role === 'host' && matchPhase === 'teleop' && (
        <p className="lobby-panel__hint">Drive with WASD / gamepad. Click the field first if keys do nothing.</p>
      )}

      {connected && role !== 'host' && (
        <p className="lobby-panel__hint">
          You are spectating. Match controls (INIT, AUTO, etc.) are on the <strong>host</strong> tab only.
          Look for the green <strong>HOST</strong> badge in the toolbar.
        </p>
      )}

      {!connected && (
        <p className="lobby-panel__hint">
          Run <code>pnpm dev:server</code> first, then Host or Join. LAN: share your IP:5191.
        </p>
      )}

      <div className="lobby-panel__modes">
        {(['solo', 'host', 'join'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className={mode === entry ? 'lobby-mode lobby-mode--active' : 'lobby-mode'}
            onClick={() => setMode(entry)}
            disabled={connected}
          >
            {entry === 'solo' ? 'Solo' : entry === 'host' ? 'Host' : 'Join'}
          </button>
        ))}
      </div>

      {mode !== 'solo' && !connected && (
        <>
          <label className="lobby-field">
            Server address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="127.0.0.1:5191"
              disabled={connecting}
            />
          </label>
          <label className="lobby-field">
            Display name
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={connecting} />
          </label>
        </>
      )}

      {error && <p className="lobby-error">{error}</p>}
      {connected && lanAddress && <p className="lobby-status">Share with friends: {lanAddress}</p>}
      {connected && rttMs !== null && <p className="lobby-status">Ping: {rttMs} ms</p>}

      <div className="lobby-panel__actions">
        {mode === 'solo' && !connected ? (
          <button type="button" className="lobby-action" onClick={onChooseSolo}>
            Play Solo
          </button>
        ) : connected ? (
          <button type="button" className="lobby-action lobby-action--danger" onClick={onDisconnect}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="lobby-action"
            disabled={connecting}
            onClick={() => onConnect(mode, address, name)}
          >
            {connecting ? 'Connecting…' : mode === 'host' ? 'Connect as Host' : 'Join Match'}
          </button>
        )}
      </div>
    </div>
  );
}
