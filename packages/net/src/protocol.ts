import type { MatchState } from '@ftc-sim/game-decode';
import type { MatchSnapshot } from '@ftc-sim/match';

export const SIM_NET_PROTOCOL_VERSION = 1;
export const DEFAULT_MATCH_PORT = 5191;
export const DEFAULT_UI_PORT = 5190;
export const SERVER_TICK_HZ = 120;
export const SNAPSHOT_HZ = 30;

export type SessionRole = 'host' | 'player' | 'spectator';

export type HostCommand =
  | 'init'
  | 'start_auto'
  | 'teleop'
  | 'infinite'
  | 'reset'
  | 'pause'
  | 'resume'
  | 'end_match';

export interface HolonomicDriveInput {
  forward: number;
  strafe: number;
  turn: number;
  brake?: boolean;
  endpointBrake?: boolean;
  /** Teleop drive frame for this input (defaults to field when omitted). */
  driveFrame?: 'field' | 'robot';
}

export interface MechanismInput {
  intake?: number;
  shoot?: boolean;
  gate?: boolean;
}

export interface InputFrame {
  seq: number;
  robotId: string;
  drive: HolonomicDriveInput;
  mechanism: MechanismInput;
  shootEdge: boolean;
  gateEdge?: boolean;
}

export interface RobotSnapshotEntry {
  id: string;
  alliance: 'blue' | 'red';
  pose: { x: number; y: number; heading: number };
  linear: { x: number; y: number };
  angular: number;
  teamNumber?: string;
}

export interface StateSnapshot {
  type: 'snapshot';
  tick: number;
  match: MatchSnapshot;
  robots: RobotSnapshotEntry[];
  artifacts: Array<{
    id: string;
    color: string;
    phase: string;
    pose: { x: number; y: number; heading: number };
    opacity: number;
  }>;
  score: {
    blue: number;
    red: number;
    motif: string;
  };
  motif: '21' | '22' | '23';
  /** Full scoring state for HUD, overlay, and ceremony. Omitted on pose-only snapshots. */
  gameState?: MatchState;
  /** Server-side AUTO follower HUD (host robot). */
  follower?: {
    running: boolean;
    completion: number;
    target: { x: number; y: number; heading: number };
  };
}

export interface RoomConfig {
  alliance: 'blue' | 'red';
  barrierHash: string;
  artifactFriction: number;
}

export type ClientMessage =
  | { type: 'hello'; protocol: number; appVersion: string; displayName: string; intent: 'host' | 'join' }
  | { type: 'input'; frame: InputFrame }
  | { type: 'host_cmd'; cmd: HostCommand }
  | { type: 'set_auto_path'; pathText: string }
  | { type: 'claim_slot'; robotId: string; teamLabel?: string }
  | { type: 'ping'; t: number }
  | { type: 'latency_report'; rttMs: number };

export type ServerMessage =
  | {
      type: 'welcome';
      playerId: string;
      role: SessionRole;
      robotId?: string;
      roomConfig: RoomConfig;
    }
  | StateSnapshot
  | {
      type: 'room_info';
      addresses: { lan: string; tunnel?: string };
      players: Array<{
        id: string;
        name: string;
        role: SessionRole;
        robotId?: string;
        rttMs?: number | null;
        sendQueueBytes?: number;
      }>;
    }
  | { type: 'server_ready'; motif: '21' | '22' | '23' }
  | { type: 'match_ended'; reason: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number }
  | {
      type: 'slot_claimed';
      robotId: string;
      playerId: string;
      playerName: string;
      teamLabel?: string;
    }
  | { type: 'slot_denied'; robotId: string; reason: string }
  | { type: 'slot_released'; robotId: string; playerId: string }
  | { type: 'audio_cue'; cue: 'charge' | 'endAutoWarning' | 'countdown' | 'firebell' | 'whistle' | 'endMatch' };
