import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchSnapshot } from '@ftc-sim/match';
import type { MatchState } from '@ftc-sim/game-decode';
import type { SimArtifactState } from '@ftc-sim/mechanisms';
import {
  encodeMessage,
  SIM_NET_PROTOCOL_VERSION,
  type HostCommand,
  type InputFrame,
  type ServerMessage,
  type StateSnapshot,
} from '@ftc-sim/net';
import type { FieldRobotCatalogEntry, FieldRobotRenderState } from '../robot/match-robots';
import { buildWsUrl } from './session-mode';

const APP_VERSION = '0.2.0';

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

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    fieldRobotsRef.current = [];
    fieldRobotCatalogRef.current = [];
    setState(EMPTY);
  }, []);

  const connect = useCallback(
    (address: string, displayName: string, intent: 'host' | 'join') => {
      disconnect();
      setState((prev) => ({ ...prev, connecting: true, error: null }));

      const ws = new WebSocket(buildWsUrl(address));
      wsRef.current = ws;

      ws.onopen = () => {
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

      ws.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === 'welcome') {
          setState((prev) => ({
            ...prev,
            connected: true,
            connecting: false,
            playerId: message.playerId,
            role: message.role,
            robotId: message.robotId ?? null,
          }));
          return;
        }

        if (message.type === 'room_info') {
          setState((prev) => ({ ...prev, lanAddress: message.addresses.lan }));
          return;
        }

        if (message.type === 'error') {
          setState((prev) => ({
            ...prev,
            error: message.message,
            connecting: false,
            connected: message.code === 'host_taken' ? prev.connected : false,
          }));
          if (message.code !== 'host_taken') {
            ws.close();
          }
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
          setState((prev) => ({ ...prev, rttMs: Date.now() - message.t }));
          return;
        }

        if (message.type === 'snapshot') {
          const fieldRobots: FieldRobotRenderState[] = message.robots.map((robot) => ({
            id: robot.id,
            alliance: robot.alliance,
            teamNumber: robot.teamNumber ?? '?',
            width: 18,
            length: 18,
            pose: robot.pose,
          }));
          fieldRobotsRef.current = fieldRobots;
          if (fieldRobotCatalogRef.current.length === 0) {
            fieldRobotCatalogRef.current = fieldRobots.map(({ id, alliance, teamNumber, width, length }) => ({
              id,
              alliance,
              teamNumber,
              width,
              length,
            }));
          }
          const player = message.robots.find((robot) => robot.id === 'player');
          setState((prev) => ({
            ...prev,
            connected: true,
            connecting: false,
            snapshot: message,
            matchSnapshot: message.match,
            gameState: message.gameState,
            fieldRobots,
            fieldRobotCatalog: fieldRobotCatalogRef.current,
            liveArtifacts: snapshotToArtifacts(message),
            pose: player?.pose ?? null,
          }));
        }
      };

      ws.onerror = () => {
        setState((prev) => ({
          ...prev,
          connecting: false,
          error: 'WebSocket connection failed',
        }));
      };

      ws.onclose = () => {
        setState((prev) => ({
          ...prev,
          connected: false,
          connecting: false,
        }));
      };
    },
    [disconnect],
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

  const ping = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeMessage({ type: 'ping', t: Date.now() }));
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    ...state,
    fieldRobotsRef,
    connect,
    disconnect,
    sendInput,
    sendHostCommand,
    ping,
  };
}
