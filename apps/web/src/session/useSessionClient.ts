import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchSnapshot } from '@ftc-sim/match';
import type { MatchAudioCue } from '@ftc-sim/match';
import type { MatchState } from '@ftc-sim/game-decode';
import type { SimArtifactState } from '@ftc-sim/mechanisms';
import {
  encodeMessage,
  SIM_NET_PROTOCOL_VERSION,
  type HostCommand,
  type InputFrame,
  type RobotSnapshotEntry,
  type ServerMessage,
  type SessionRole,
  type StateSnapshot,
} from '@ftc-sim/net';

export interface RoomPlayer {
  id: string;
  name: string;
  role: SessionRole;
  robotId?: string;
  rttMs?: number | null;
  sendQueueBytes?: number;
}
import type { FieldRobotCatalogEntry, FieldRobotRenderState } from '../robot/match-robots';
import { DEFAULT_PRACTICE_TEAMS, PLAYER_ROBOT_ID } from '../robot/match-robots';
import { buildWsUrl } from './session-mode';

declare const __APP_VERSION__: string;

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.2.6';
const CONNECT_TIMEOUT_MS = 12_000;
const HUD_UPDATE_MS = 1000 / 12;

const DEFAULT_TEAM_BY_ROBOT_ID: Record<string, string> = {
  [PLAYER_ROBOT_ID]: DEFAULT_PRACTICE_TEAMS.blueFar,
  'blue-near': DEFAULT_PRACTICE_TEAMS.blueNear,
  'red-far': DEFAULT_PRACTICE_TEAMS.redFar,
  'red-near': DEFAULT_PRACTICE_TEAMS.redNear,
};

function snapshotRobotToFieldState(robot: RobotSnapshotEntry): FieldRobotRenderState {
  const teamNumber = robot.teamNumber ?? DEFAULT_TEAM_BY_ROBOT_ID[robot.id] ?? '?';
  return {
    id: robot.id,
    alliance: robot.alliance,
    teamNumber,
    width: 18,
    length: 18,
    pose: robot.pose,
  };
}

function snapshotRobotToCatalog(robot: RobotSnapshotEntry): FieldRobotCatalogEntry {
  return {
    id: robot.id,
    alliance: robot.alliance,
    teamNumber: robot.teamNumber ?? DEFAULT_TEAM_BY_ROBOT_ID[robot.id] ?? '?',
    width: 18,
    length: 18,
  };
}

export interface SessionClientState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  playerId: string | null;
  role: 'host' | 'player' | 'spectator' | null;
  robotId: string | null;
  rttMs: number | null;
  lanAddress: string | null;
  snapshot: StateSnapshot | null;
  matchSnapshot: MatchSnapshot | null;
  gameState: MatchState | null;
  fieldRobots: FieldRobotRenderState[];
  fieldRobotCatalog: FieldRobotCatalogEntry[];
  liveArtifacts: SimArtifactState[];
  pose: { x: number; y: number; heading: number } | null;
  roomPlayers: RoomPlayer[];
  slotError: string | null;
  netFollower: StateSnapshot['follower'] | null;
}

const EMPTY: SessionClientState = {
  connected: false,
  connecting: false,
  error: null,
  playerId: null,
  role: null,
  robotId: null,
  rttMs: null,
  lanAddress: null,
  snapshot: null,
  matchSnapshot: null,
  gameState: null,
  fieldRobots: [],
  fieldRobotCatalog: [],
  liveArtifacts: [],
  pose: null,
  roomPlayers: [],
  slotError: null,
  netFollower: null,
};

function snapshotToArtifacts(snapshot: StateSnapshot): SimArtifactState[] {
  return snapshot.artifacts.map((artifact) => ({
    id: artifact.id,
    color: artifact.color as SimArtifactState['color'],
    phase: artifact.phase as SimArtifactState['phase'],
    bodyId: `artifact_${artifact.id}`,
    pose: artifact.pose,
    opacity: artifact.opacity,
  }));
}

export function useSessionClient() {
  const [state, setState] = useState<SessionClientState>(EMPTY);
  const wsRef = useRef<WebSocket | null>(null);
  const inputSeqRef = useRef(0);
  const fieldRobotsRef = useRef<FieldRobotRenderState[]>([]);
  const fieldRobotCatalogRef = useRef<FieldRobotCatalogEntry[]>([]);
  const netRobotMotionRef = useRef<RobotSnapshotEntry[]>([]);
  const liveArtifactsRef = useRef<SimArtifactState[]>([]);
  const gameStateRef = useRef<MatchState | null>(null);
  const robotIdRef = useRef<string | null>(null);
  const connectGenRef = useRef(0);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRttRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHudPaintRef = useRef(0);
  const lastSnapshotAtRef = useRef(0);
  const lastMatchPhaseRef = useRef<string | null>(null);
  const onAudioCueRef = useRef<((cue: MatchAudioCue) => void) | null>(null);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearConnectTimeout();
    if (pingIntervalRef.current) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    lastRttRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    }
    fieldRobotsRef.current = [];
    fieldRobotCatalogRef.current = [];
    netRobotMotionRef.current = [];
    liveArtifactsRef.current = [];
    gameStateRef.current = null;
    robotIdRef.current = null;
    setState(EMPTY);
  }, [clearConnectTimeout]);

  const applySnapshot = useCallback((message: StateSnapshot, force = false) => {
    const fieldRobots = message.robots.map(snapshotRobotToFieldState);
    fieldRobotsRef.current = fieldRobots;
    fieldRobotCatalogRef.current = message.robots.map(snapshotRobotToCatalog);
    netRobotMotionRef.current = message.robots;
    liveArtifactsRef.current = snapshotToArtifacts(message);
    if (message.gameState) {
      gameStateRef.current = message.gameState;
    }

    const ownedId = robotIdRef.current;
    const owned =
      (ownedId ? message.robots.find((robot) => robot.id === ownedId) : null) ??
      message.robots.find((robot) => robot.id === 'player');

    const now = performance.now();
    lastSnapshotAtRef.current = now;
    const phaseChanged = lastMatchPhaseRef.current !== message.match.phase;
    lastMatchPhaseRef.current = message.match.phase;
    const throttleElapsed = now - lastHudPaintRef.current >= HUD_UPDATE_MS;

    if (!force && !phaseChanged && !throttleElapsed) {
      return;
    }
    lastHudPaintRef.current = now;

    setState((prev) => ({
      ...prev,
      connected: true,
      connecting: false,
      snapshot: message,
      matchSnapshot: message.match,
      gameState: message.gameState ?? gameStateRef.current,
      fieldRobots,
      fieldRobotCatalog: fieldRobotCatalogRef.current,
      liveArtifacts: liveArtifactsRef.current,
      pose: owned?.pose ?? null,
      netFollower: message.follower ?? null,
    }));
  }, []);

  const connect = useCallback(
    (address: string, displayName: string, intent: 'host' | 'join') => {
      clearConnectTimeout();
      const gen = ++connectGenRef.current;

      const oldWs = wsRef.current;
      wsRef.current = null;
      if (oldWs) {
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        oldWs.onclose = null;
        oldWs.close();
      }

      robotIdRef.current = null;
      fieldRobotsRef.current = [];
      fieldRobotCatalogRef.current = [];
      netRobotMotionRef.current = [];
      liveArtifactsRef.current = [];
      gameStateRef.current = null;
      lastMatchPhaseRef.current = null;
      setState({ ...EMPTY, connecting: true, error: null });

      let handshakeDone = false;

      const finishConnectTimeout = () => {
        if (connectGenRef.current !== gen || handshakeDone) return;
        const ws = wsRef.current;
        if (ws) {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
          wsRef.current = null;
        }
        setState((prev) => ({
          ...prev,
          connecting: false,
          connected: false,
          error: 'Connection timed out — check host address and port 5191',
        }));
      };

      connectTimeoutRef.current = setTimeout(finishConnectTimeout, CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(buildWsUrl(address));
      wsRef.current = ws;

      const sendHello = () => {
        if (connectGenRef.current !== gen || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          encodeMessage({
            type: 'hello',
            protocol: SIM_NET_PROTOCOL_VERSION,
            appVersion: APP_VERSION,
            displayName,
            intent,
          }),
        );
      };

      const helloRetry = window.setInterval(() => {
        if (connectGenRef.current !== gen || handshakeDone) {
          window.clearInterval(helloRetry);
          return;
        }
        sendHello();
      }, 2_000);

      const handleMessage = (event: MessageEvent) => {
        if (connectGenRef.current !== gen) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === 'welcome') {
          handshakeDone = true;
          window.clearInterval(helloRetry);
          clearConnectTimeout();
          robotIdRef.current = message.robotId ?? null;
          setState((prev) => ({
            ...prev,
            connected: true,
            connecting: false,
            playerId: message.playerId,
            role: message.role,
            robotId: message.robotId ?? null,
            slotError: null,
          }));
          return;
        }

        if (message.type === 'server_ready') {
          clearConnectTimeout();
          setState((prev) => ({
            ...prev,
            connected: prev.playerId ? true : prev.connected,
            connecting: false,
          }));
          return;
        }

        if (message.type === 'room_info') {
          setState((prev) => ({
            ...prev,
            lanAddress: message.addresses.lan,
            roomPlayers: message.players,
          }));
          return;
        }

        if (message.type === 'audio_cue') {
          onAudioCueRef.current?.(message.cue);
          return;
        }

        if (message.type === 'slot_claimed') {
          setState((prev) => {
            const roomPlayers = prev.roomPlayers.map((player) =>
              player.id === message.playerId ? { ...player, robotId: message.robotId } : player,
            );
            const hasPlayer = roomPlayers.some((player) => player.id === message.playerId);
            const nextPlayers = hasPlayer
              ? roomPlayers
              : [
                  ...roomPlayers,
                  { id: message.playerId, name: message.playerName, role: 'player' as const, robotId: message.robotId },
                ];
            const isSelf = prev.playerId === message.playerId;
            if (isSelf) robotIdRef.current = message.robotId;
            return {
              ...prev,
              roomPlayers: nextPlayers,
              robotId: isSelf ? message.robotId : prev.robotId,
              slotError: null,
            };
          });
          return;
        }

        if (message.type === 'slot_released') {
          setState((prev) => {
            const roomPlayers = prev.roomPlayers.map((player) =>
              player.id === message.playerId ? { ...player, robotId: undefined } : player,
            );
            const isSelf = prev.playerId === message.playerId;
            if (isSelf) robotIdRef.current = null;
            return {
              ...prev,
              roomPlayers,
              robotId: isSelf ? null : prev.robotId,
            };
          });
          return;
        }

        if (message.type === 'slot_denied') {
          setState((prev) => ({
            ...prev,
            slotError: message.reason,
          }));
          return;
        }

        if (message.type === 'error') {
          if (message.code === 'host_taken') {
            setState((prev) => ({ ...prev, error: message.message }));
            return;
          }
          handshakeDone = true;
          window.clearInterval(helloRetry);
          clearConnectTimeout();
          setState((prev) => ({
            ...prev,
            error: message.message,
            connecting: false,
            connected: false,
          }));
          ws.close();
          return;
        }

        if (message.type === 'match_ended') {
          setState((prev) => ({
            ...prev,
            connected: false,
            error: `Match ended: ${message.reason}`,
          }));
          return;
        }

        if (message.type === 'pong') {
          const rttMs = Date.now() - message.t;
          lastRttRef.current = rttMs;
          setState((prev) => ({ ...prev, rttMs }));
          const wsOpen = wsRef.current;
          if (wsOpen && wsOpen.readyState === WebSocket.OPEN) {
            wsOpen.send(encodeMessage({ type: 'latency_report', rttMs }));
          }
          return;
        }

        if (message.type === 'snapshot') {
          clearConnectTimeout();
          applySnapshot(message);
        }
      };

      ws.addEventListener('message', handleMessage);
      ws.onopen = () => {
        if (connectGenRef.current !== gen) return;
        sendHello();
      };

      ws.onerror = () => {
        if (connectGenRef.current !== gen) return;
        window.clearInterval(helloRetry);
        clearConnectTimeout();
        setState((prev) => ({
          ...prev,
          connecting: false,
          error: prev.error ?? 'WebSocket connection failed',
        }));
      };

      ws.onclose = () => {
        if (connectGenRef.current !== gen) return;
        window.clearInterval(helloRetry);
        clearConnectTimeout();
        setState((prev) => ({
          ...prev,
          connected: false,
          connecting: false,
          error: prev.connecting ? 'Connection closed before handshake completed' : prev.error,
        }));
      };
    },
    [applySnapshot, clearConnectTimeout],
  );

  const sendInput = useCallback((frame: Omit<InputFrame, 'seq'>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    inputSeqRef.current += 1;
    ws.send(
      encodeMessage({
        type: 'input',
        frame: { ...frame, seq: inputSeqRef.current },
      }),
    );
  }, []);

  const sendHostCommand = useCallback((cmd: HostCommand) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeMessage({ type: 'host_cmd', cmd }));
  }, []);

  const sendAutoPath = useCallback((pathText: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeMessage({ type: 'set_auto_path', pathText }));
  }, []);

  const claimSlot = useCallback((robotId: string, teamLabel?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setState((prev) => ({ ...prev, slotError: null }));
    ws.send(encodeMessage({ type: 'claim_slot', robotId, teamLabel: teamLabel?.trim() || undefined }));
  }, []);

  const ping = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeMessage({ type: 'ping', t: Date.now() }));
  }, []);

  const setOnAudioCue = useCallback((handler: ((cue: MatchAudioCue) => void) | null) => {
    onAudioCueRef.current = handler;
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  useEffect(() => {
    if (!state.connected) {
      if (pingIntervalRef.current) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      return;
    }
    ping();
    pingIntervalRef.current = window.setInterval(() => ping(), 2_000);
    return () => {
      if (pingIntervalRef.current) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
  }, [state.connected, ping]);

  return {
    ...state,
    fieldRobotsRef,
    liveArtifactsRef,
    netRobotMotionRef,
    lastSnapshotAtRef,
    connect,
    disconnect,
    sendInput,
    sendHostCommand,
    sendAutoPath,
    claimSlot,
    ping,
    setOnAudioCue,
  };
}
