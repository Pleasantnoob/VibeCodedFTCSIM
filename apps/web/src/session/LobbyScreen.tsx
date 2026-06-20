import { useEffect, useState } from 'react';
import type { SessionMode } from './session-mode';
import { fetchHostInfo, readInternetAddressLocal } from './internet-address';
import {
  LOBBY_SLOT_ORDER,
  ROBOT_SLOT_LABELS,
  type ClaimableRobotId,
} from '../robot/match-robots';
import type { RoomPlayer } from './useSessionClient';
import './lobby.css';

export interface LobbyScreenProps {
  initialMode: SessionMode;
  initialAddress: string;
  initialName: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  role: 'host' | 'player' | 'spectator' | null;
  robotId: string | null;
  playerId: string | null;
  roomPlayers: RoomPlayer[];
  slotError: string | null;
  lanAddress: string | null;
  rttMs: number | null;
  matchPhase: string | null;
  versionWarning?: string | null;
  onChooseSolo: () => void;
  onConnect: (mode: 'host' | 'join', address: string, name: string) => void;
  onDisconnect: () => void;
  onClaimSlot: (robotId: ClaimableRobotId, teamLabel: string) => void;
  onHostStartDriving?: () => void;
  onOpenControls?: () => void;
}

export function LobbyScreen({
  initialMode,
  initialAddress,
  initialName,
  connected,
  connecting,
  error,
  role,
  robotId,
  playerId,
  roomPlayers,
  slotError,
  lanAddress,
  rttMs,
  matchPhase,
  versionWarning,
  onChooseSolo,
  onConnect,
  onDisconnect,
  onClaimSlot,
  onHostStartDriving,
  onOpenControls,
}: LobbyScreenProps) {
  const fromLauncher = initialMode === 'host' || initialMode === 'join';
  const [mode, setMode] = useState<'solo' | 'host' | 'join'>(initialMode === 'solo' ? 'solo' : initialMode);
  const [address, setAddress] = useState(initialAddress);
  const [name, setName] = useState(initialName);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [internetCopied, setInternetCopied] = useState(false);
  const [internetInvite, setInternetInvite] = useState('');
  const [collapsed, setCollapsed] = useState(initialMode === 'solo' && !connected);
  const [teamLabel, setTeamLabel] = useState('');

  useEffect(() => {
    if (fromLauncher && !robotId && connected) {
      setCollapsed(false);
    }
  }, [fromLauncher, robotId, connected]);

  useEffect(() => {
    if (!connected || role !== 'host') {
      setInternetInvite('');
      return;
    }
    void fetchHostInfo().then((info) => {
      const remote =
        info?.internetAddress?.trim() ||
        readInternetAddressLocal() ||
        info?.suggestedInternetAddress?.trim() ||
        '';
      setInternetInvite(remote);
    });
  }, [connected, role]);

  const slotOwner = (slotId: ClaimableRobotId): RoomPlayer | undefined =>
    roomPlayers.find((player) => player.robotId === slotId);

  const drivingLabel = robotId
    ? ROBOT_SLOT_LABELS[robotId as ClaimableRobotId] ?? robotId
    : null;

  if (collapsed) {
    const label = connected
      ? drivingLabel
        ? `Driving ${drivingLabel}`
        : role === 'host'
          ? 'Host — pick robot'
          : 'Pick your robot'
      : fromLauncher
        ? initialMode === 'host'
          ? 'Host'
          : 'Join'
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
      ? drivingLabel
        ? `Driving ${drivingLabel}`
        : 'Pick your robot below'
      : fromLauncher
        ? initialMode === 'join'
          ? 'Enter host address'
          : 'Connecting…'
        : 'Not connected';

  const showFullLobby = !fromLauncher;
  const showJoinForm = !connected && (fromLauncher ? initialMode === 'join' : mode === 'join' || mode === 'host');
  const canStartDriving =
    connected && role === 'host' && robotId && matchPhase === 'setup' && onHostStartDriving;

  return (
    <div className="lobby-panel">
      <div className="lobby-panel__header">
        <strong>{fromLauncher ? (initialMode === 'host' ? 'Host match' : 'Join match') : 'Multiplayer'}</strong>
        <button type="button" className="lobby-panel__close" onClick={() => setCollapsed(true)} aria-label="Close">
          Close
        </button>
      </div>

      <p className={`lobby-panel__status${connected ? ' lobby-panel__status--live' : ''}`}>{statusLine}</p>
      {connected && versionWarning && (
        <p className="lobby-version-warn" title={versionWarning}>
          {versionWarning}
        </p>
      )}
      {connecting && error && <p className="lobby-error">{error}</p>}

      {connected && (
        <div className="lobby-slots">
          <p className="lobby-share__label">Pick your robot</p>
          <label className="lobby-field">
            Team # or name (shown on field)
            <input
              value={teamLabel}
              onChange={(e) => setTeamLabel(e.target.value)}
              placeholder="e.g. 12345 or Driver"
              maxLength={12}
            />
          </label>
          <div className="lobby-slots__grid">
            {LOBBY_SLOT_ORDER.map((slotId) => {
              const owner = slotOwner(slotId);
              const isMine = robotId === slotId;
              const taken = Boolean(owner && owner.id !== playerId);
              return (
                <button
                  key={slotId}
                  type="button"
                  className={`lobby-slot${isMine ? ' lobby-slot--mine' : ''}${taken ? ' lobby-slot--taken' : ''}`}
                  disabled={taken}
                  onClick={() => onClaimSlot(slotId, teamLabel)}
                >
                  <span className="lobby-slot__name">{ROBOT_SLOT_LABELS[slotId]}</span>
                  <span className="lobby-slot__meta">
                    {isMine ? 'You' : owner ? owner.name : taken ? 'Taken' : 'Open'}
                  </span>
                </button>
              );
            })}
          </div>
          {slotError && <p className="lobby-error">{slotError}</p>}
        </div>
      )}

      {connected && drivingLabel && (
        <p className="lobby-panel__hint">WASD / gamepad to drive. Click the field first if keys do nothing.</p>
      )}

      {connected && !drivingLabel && role !== 'host' && (
        <p className="lobby-panel__hint">Choose an open slot, then wait for the host to press Start driving.</p>
      )}

      {connected && !drivingLabel && role === 'host' && (
        <p className="lobby-panel__hint">Pick your robot, then press Start driving below.</p>
      )}

      {canStartDriving && (
        <button type="button" className="lobby-action lobby-action--start" onClick={onHostStartDriving}>
          Start driving
        </button>
      )}

      {connected && role === 'host' && roomPlayers.length > 0 && (
        <div className="lobby-latency">
          <p className="lobby-share__label">Player latency (host view)</p>
          <ul className="lobby-latency__list">
            {roomPlayers.map((player) => (
              <li key={player.id} className="lobby-latency__row">
                <span className="lobby-latency__name">
                  {player.name}
                  {player.id === playerId ? ' (you)' : ''}
                  {player.role === 'host' ? ' · host' : ''}
                </span>
                <span
                  className={`lobby-latency__ms${
                    player.rttMs != null && player.rttMs > 120 ? ' lobby-latency__ms--high' : ''
                  }`}
                >
                  {player.rttMs != null ? `${player.rttMs} ms` : '…'}
                </span>
              </li>
            ))}
          </ul>
          <p className="lobby-panel__hint lobby-latency__hint">
            Logged on the host PC console as <code>[match-server] latency …</code>
          </p>
        </div>
      )}

      {connected && role === 'host' && lanAddress && (
        <div className="lobby-host-share">
          <p className="lobby-share__label">Same Wi‑Fi / LAN</p>
          <code className="lobby-host-share__addr">{lanAddress}</code>
          <button
            type="button"
            className="lobby-share__btn lobby-share__btn--wide"
            onClick={async () => {
              await navigator.clipboard.writeText(lanAddress);
              setInviteCopied(true);
              setInternetCopied(false);
            }}
          >
            {inviteCopied ? 'LAN copied!' : 'Copy LAN address'}
          </button>
          {internetInvite && internetInvite !== lanAddress && (
            <>
              <p className="lobby-share__label">Internet friends (port forwarded)</p>
              <code className="lobby-host-share__addr">{internetInvite}</code>
              <button
                type="button"
                className="lobby-share__btn lobby-share__btn--wide"
                onClick={async () => {
                  await navigator.clipboard.writeText(internetInvite);
                  setInternetCopied(true);
                  setInviteCopied(false);
                }}
              >
                {internetCopied ? 'Internet copied!' : 'Copy internet address'}
              </button>
            </>
          )}
        </div>
      )}

      {showFullLobby && (
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
      )}

      {showJoinForm && !connected && (
        <>
          <label className="lobby-field">
            Host address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="192.168.x.x:5191"
              disabled={connecting}
            />
          </label>
          {!fromLauncher && (
            <label className="lobby-field">
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={connecting} />
            </label>
          )}
        </>
      )}

      {error && !error.includes('host is already') && <p className="lobby-error">{error}</p>}
      {connected && lanAddress && !fromLauncher && (
        <p className="lobby-status">LAN: {lanAddress}</p>
      )}
      {connected && rttMs !== null && role !== 'host' && (
        <p className="lobby-status">Ping: {rttMs} ms</p>
      )}
      {connected && rttMs !== null && role === 'host' && (
        <p className="lobby-status">Your ping: {rttMs} ms</p>
      )}

      <div className="lobby-panel__actions">
        {connected && onOpenControls && role !== 'spectator' && (
          <button type="button" className="lobby-action lobby-action--secondary" onClick={onOpenControls}>
            Keyboard &amp; drive mode
          </button>
        )}
        {showFullLobby && mode === 'solo' && !connected ? (
          <button type="button" className="lobby-action" onClick={onChooseSolo}>
            Play Solo
          </button>
        ) : connected ? (
          <button type="button" className="lobby-action lobby-action--danger" onClick={onDisconnect}>
            Leave match
          </button>
        ) : (
          !fromLauncher || initialMode === 'join' ? (
            <button
              type="button"
              className="lobby-action"
              disabled={connecting}
              onClick={() => {
                const connectMode = fromLauncher ? initialMode : mode;
                if (connectMode === 'solo') return;
                onConnect(connectMode, address, name);
              }}
            >
              {connecting ? 'Connecting…' : fromLauncher || mode === 'host' ? 'Connect' : 'Join'}
            </button>
          ) : null
        )}
      </div>
    </div>
  );
}
