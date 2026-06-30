import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { matchAudioCues, type MatchAudioCue } from '@ftc-sim/match';
import type { MatchSnapshot } from '@ftc-sim/match';
import {
  decodeClientMessage,
  DEFAULT_MATCH_PORT,
  encodeMessage,
  hashBarriers,
  InputBuffer,
  SERVER_TICK_HZ,
  SIM_NET_PROTOCOL_VERSION,
  SNAPSHOT_HZ,
  type ClientMessage,
  type ServerMessage,
  type StateSnapshot,
} from '@ftc-sim/net';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import {
  CLAIMABLE_ROBOT_IDS,
  DEFAULT_PRACTICE_TEAMS,
  botSlotsFromNetConfig,
  isClaimableRobotId,
  playerSpawnPose,
  practiceFieldRobots,
  SimSession,
  simRobotFootprint,
  DEFAULT_SIM_ROBOT_CONFIG,
} from '@ftc-sim/session';
import { defaultPracticeBotSlots, type BotSlotConfig } from '@ftc-sim/bot';

import { startFixedTickLoop } from './tick-loop.js';

const APP_VERSION = readAppVersion();
const SNAPSHOT_EVERY = Math.round(SERVER_TICK_HZ / SNAPSHOT_HZ);
const MAX_CLIENTS = 8;
const MAX_SNAPSHOT_EVENTS = 20;
const BOT_FILL_UNCLAIMED = process.env.BOT_FILL_UNCLAIMED !== '0';
const BOT_DIFFICULTY = (process.env.BOT_DIFFICULTY ?? 'normal') as BotSlotConfig['difficulty'];

interface ClientRecord {
  id: string;
  ws: WebSocket;
  name: string;
  role: 'host' | 'player' | 'spectator';
  robotId?: string;
  input: InputBuffer;
  remoteAddress: string;
  rttMs: number | null;
  sendQueueBytes: number;
  lastLatencyLogAt: number;
}

function formatLatency(client: ClientRecord): string {
  const rtt = client.rttMs != null ? `${client.rttMs}ms` : 'unknown';
  const queue =
    client.sendQueueBytes > 0 ? ` · send queue ${Math.round(client.sendQueueBytes / 1024)}KB` : '';
  return `${client.name} (${client.id}) ${rtt}${queue} · ${client.remoteAddress}`;
}

function logClientLatency(client: ClientRecord, force = false): void {
  const now = Date.now();
  if (!force && now - client.lastLatencyLogAt < 5_000) return;
  client.lastLatencyLogAt = now;
  console.log(`[match-server] latency ${formatLatency(client)}`);
}

function logLatencySummary(clients: Map<WebSocket, ClientRecord>): void {
  if (clients.size === 0) return;
  const parts = [...clients.values()].map((c) => {
    const rtt = c.rttMs != null ? `${c.rttMs}ms` : '?';
    return `${c.name}=${rtt}`;
  });
  console.log(`[match-server] latency summary (${clients.size} clients): ${parts.join(', ')}`);
}

function readAppVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromEnv = process.env.FTC_SIM_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;

  const bundledVersion = join(here, 'app-version.txt');
  if (existsSync(bundledVersion)) {
    const text = readFileSync(bundledVersion, 'utf8').trim();
    if (text) return text;
  }

  const candidates = [
    join(here, '..', '..', 'web', 'package.json'),
    join(here, '..', '..', 'desktop', 'package.json'),
    join(here, '..', 'package.json'),
  ];
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* try next */
    }
  }
  return '0.0.0';
}

function lanAddress(port: number): string {
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return `${entry.address}:${port}`;
      }
    }
  }
  return `127.0.0.1:${port}`;
}

function buildSession(): SimSession {
  const field = getDecodeField();
  const footprint = simRobotFootprint(DEFAULT_SIM_ROBOT_CONFIG);
  const barriers = getBarrierBodies(field).map((body) => ({
    id: body.id,
    label: body.label ?? body.id,
    vertices: getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
  }));

  return new SimSession({
    field,
    alliance: 'blue',
    artifactStaging: getMatchArtifactStaging(),
    barriers,
    startPose: playerSpawnPose(),
    robotConfig: DEFAULT_SIM_ROBOT_CONFIG,
    practiceRobots: practiceFieldRobots(footprint),
    playerTeamNumber: DEFAULT_PRACTICE_TEAMS.blueFar,
    onlyClaimedRobots: true,
  });
}

function syncHostBots(
  session: SimSession,
  clients: Map<WebSocket, ClientRecord>,
  hostBotTemplate: BotSlotConfig[] | null,
): void {
  if (!BOT_FILL_UNCLAIMED) return;
  const claimed = new Set<string>();
  for (const client of clients.values()) {
    if (client.robotId) claimed.add(client.robotId);
  }
  const template = hostBotTemplate ?? defaultPracticeBotSlots(BOT_DIFFICULTY);
  const slots = template.map((slot) => ({
    ...slot,
    enabled: slot.enabled && !claimed.has(slot.robotId),
  }));
  session.setBotSlots(slots);
}

function snapshotHash(snapshot: StateSnapshot): string {
  const match = snapshot.match;
  let hash = `${snapshot.tick}|${match.phase}|${match.timeElapsed}|${match.running}|${match.paused}`;
  for (const robot of snapshot.robots) {
    hash += `|${robot.id}:${robot.pose.x.toFixed(2)},${robot.pose.y.toFixed(2)}`;
  }
  for (const artifact of snapshot.artifacts) {
    hash += `|${artifact.id}:${artifact.phase}:${artifact.pose.x.toFixed(2)},${artifact.pose.y.toFixed(2)}`;
  }
  return hash;
}

function isActiveSimulationPhase(phase: string): boolean {
  return phase === 'auto' || phase === 'transition' || phase === 'teleop';
}

async function main(): Promise<void> {
  const port = Number(process.env.MATCH_PORT ?? DEFAULT_MATCH_PORT);
  const session = buildSession();
  await session.init();

  const clients = new Map<WebSocket, ClientRecord>();
  let nextClientId = 1;
  let hostClient: ClientRecord | null = null;
  let hostBotTemplate: BotSlotConfig[] | null = null;

  const broadcast = (message: ServerMessage, except?: WebSocket) => {
    const raw = encodeMessage(message);
    for (const [ws] of clients) {
      if (ws === except || ws.readyState !== ws.OPEN) continue;
      if (ws.bufferedAmount > 256 * 1024) continue;
      ws.send(raw);
    }
  };

  const sendRoomInfo = () => {
    broadcast({
      type: 'room_info',
      addresses: { lan: lanAddress(port) },
      players: [...clients.values()].map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        robotId: c.robotId,
        rttMs: c.rttMs,
        sendQueueBytes: c.sendQueueBytes,
      })),
    });
  };

  let lastRoomInfoBroadcastAt = 0;
  const sendRoomInfoDebounced = (force = false) => {
    const now = Date.now();
    if (!force && now - lastRoomInfoBroadcastAt < 5_000) return;
    lastRoomInfoBroadcastAt = now;
    sendRoomInfo();
  };

  const robotIdTaken = (robotId: string, except?: ClientRecord): boolean => {
    for (const client of clients.values()) {
      if (client === except) continue;
      if (client.robotId === robotId) return true;
    }
    return false;
  };

  const claimSlot = (
    client: ClientRecord,
    robotId: string,
    teamLabel: string | undefined,
    ws: WebSocket,
  ): void => {
    if (!isClaimableRobotId(robotId)) {
      ws.send(encodeMessage({ type: 'slot_denied', robotId, reason: 'Invalid robot slot' }));
      return;
    }
    if (robotIdTaken(robotId, client)) {
      ws.send(encodeMessage({ type: 'slot_denied', robotId, reason: 'Slot already taken' }));
      return;
    }
    const previous = client.robotId;
    client.robotId = robotId;
    if (previous && previous !== robotId) {
      session.releaseRobotSlot(previous);
      broadcast({ type: 'slot_released', robotId: previous, playerId: client.id });
    }
    const label = teamLabel?.trim();
    session.claimRobotSlot(robotId, label);
    broadcast({
      type: 'slot_claimed',
      robotId,
      playerId: client.id,
      playerName: client.name,
      teamLabel: label,
    });
    broadcast(session.buildNetSnapshot(MAX_SNAPSHOT_EVENTS));
    sendRoomInfoDebounced(true);
    syncHostBots(session, clients, hostBotTemplate);
  };

  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('FTC Sim match-server - connect via WebSocket\n');
  });

  const wss = new WebSocketServer({ server: httpServer });
  const peerAddresses = new Map<WebSocket, string>();

  wss.on('connection', (ws, req) => {
    const remoteAddress = req.socket.remoteAddress ?? 'unknown';
    peerAddresses.set(ws, remoteAddress);
    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString();
      const message = decodeClientMessage(raw);
      if (!message) {
        if (!clients.has(ws)) {
          ws.send(
            encodeMessage({
              type: 'error',
              code: 'bad_message',
              message: 'Unrecognized message format',
            }),
          );
          ws.close();
        }
        return;
      }
      handleMessage(ws, message);
    });

    ws.on('close', () => {
      peerAddresses.delete(ws);
      const client = clients.get(ws);
      if (!client) return;
      const releasedRobot = client.robotId;
      clients.delete(ws);
      if (releasedRobot) {
        session.releaseRobotSlot(releasedRobot);
        broadcast({ type: 'slot_released', robotId: releasedRobot, playerId: client.id });
        broadcast(session.buildNetSnapshot(MAX_SNAPSHOT_EVENTS));
        syncHostBots(session, clients, hostBotTemplate);
      }
      if (client === hostClient) {
        hostClient = null;
        broadcast({ type: 'match_ended', reason: 'host_disconnected' });
      }
      console.log(`[match-server] left ${client.name} (${client.id})`);
      sendRoomInfoDebounced(true);
    });
  });

  let tickCounter = 0;
  let prevMatchSnapshot: MatchSnapshot | null = null;
  let lastSnapshotHash = '';
  const IDLE_TICK_STRIDE = Math.max(1, Math.round(SERVER_TICK_HZ / 10));

  const broadcastAudioCues = (prev: MatchSnapshot | null, next: MatchSnapshot) => {
    for (const cue of matchAudioCues(prev, next)) {
      broadcast({ type: 'audio_cue', cue: cue as MatchAudioCue });
    }
  };

  function handleMessage(ws: WebSocket, message: ClientMessage): void {
    if (message.type === 'hello') {
      if (clients.size >= MAX_CLIENTS && !clients.has(ws)) {
        ws.send(
          encodeMessage({
            type: 'error',
            code: 'room_full',
            message: `Match room is full (${MAX_CLIENTS} clients max)`,
          }),
        );
        ws.close();
        return;
      }

      try {
      if (message.protocol !== SIM_NET_PROTOCOL_VERSION) {
        ws.send(
          encodeMessage({
            type: 'error',
            code: 'version_mismatch',
            message: `Expected protocol ${SIM_NET_PROTOCOL_VERSION}, got ${message.protocol}`,
          }),
        );
        ws.close();
        return;
      }

      const wantsHost = message.intent === 'host';
      const hasHost = hostClient !== null;
      let role: ClientRecord['role'] = 'player';
      let robotId: string | undefined;
      let hostTaken = false;

      if (wantsHost && !hasHost) {
        role = 'host';
      } else if (wantsHost && hasHost) {
        hostTaken = true;
        role = 'player';
      }

      const record: ClientRecord = {
        id: `p${nextClientId++}`,
        ws,
        name: message.displayName || 'Player',
        role,
        robotId,
        input: new InputBuffer(),
        remoteAddress: peerAddresses.get(ws) ?? 'unknown',
        rttMs: null,
        sendQueueBytes: 0,
        lastLatencyLogAt: 0,
      };
      clients.set(ws, record);
      if (role === 'host') hostClient = record;
      if (role === 'host' && message.hostRoom) {
        session.applyHostRoomSettings(message.hostRoom);
      }
      if (role === 'host') {
        claimSlot(record, 'player', message.hostRoom?.teamLabel, ws);
      }

      const field = getDecodeField();
      const barriers = getBarrierBodies(field).map((body) => ({
        id: body.id,
        vertices: getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
      }));
      const hostRoom = session.getHostRoomSettings();

      ws.send(
        encodeMessage({
          type: 'welcome',
          playerId: record.id,
          role: record.role,
          robotId: record.robotId,
          serverAppVersion: APP_VERSION,
          roomConfig: {
            alliance: 'blue',
            barrierHash: hashBarriers(barriers),
            artifactFriction: 0.25,
            robotPreload: hostRoom.robotPreload,
            robot: hostRoom.robot,
          },
        }),
      );
      if (hostTaken) {
        ws.send(
          encodeMessage({
            type: 'error',
            code: 'host_taken',
            message: 'A host is already connected. Use Join to spectate.',
          }),
        );
      }
      const motif = session.getState().matchGameState?.obeliskMotif ?? '21';
      setImmediate(() => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(encodeMessage({ type: 'server_ready', motif }));
        ws.send(encodeMessage(session.buildNetSnapshot(MAX_SNAPSHOT_EVENTS)));
        sendRoomInfoDebounced(true);
        console.log(`[match-server] joined ${record.name} (${record.id}) as ${record.role} from ${record.remoteAddress}`);
      });
      return;
      } catch (error) {
        console.error('[match-server] hello failed:', error);
        ws.send(
          encodeMessage({
            type: 'error',
            code: 'handshake_failed',
            message: 'Server failed to complete handshake',
          }),
        );
        ws.close();
        return;
      }
    }

    const client = clients.get(ws);
    if (!client) return;

    if (message.type === 'input') {
      if (!client.robotId) return;
      client.input.set({ ...message.frame, robotId: client.robotId });
      return;
    }

    if (message.type === 'claim_slot') {
      claimSlot(client, message.robotId, message.teamLabel, ws);
      return;
    }

    if (message.type === 'host_cmd') {
      if (client.role !== 'host') return;
      const beforeSnap = session.clock.snapshot();
      session.applyHostCommand(message.cmd);
      const afterSnap = session.clock.snapshot();
      broadcastAudioCues(beforeSnap, afterSnap);
      prevMatchSnapshot = afterSnap;
      broadcast(session.buildNetSnapshot(MAX_SNAPSHOT_EVENTS, true));
      return;
    }

    if (message.type === 'set_auto_path') {
      if (client.role !== 'host') return;
      try {
        session.loadAutoPath(message.pathText);
      } catch (error) {
        ws.send(
          encodeMessage({
            type: 'error',
            code: 'bad_path',
            message: error instanceof Error ? error.message : 'Invalid auto path',
          }),
        );
      }
      return;
    }

    if (message.type === 'set_bot_slots') {
      if (client.role !== 'host') return;
      try {
        hostBotTemplate = botSlotsFromNetConfig(message.slots);
        syncHostBots(session, clients, hostBotTemplate);
      } catch (error) {
        ws.send(
          encodeMessage({
            type: 'error',
            code: 'bad_bot_slots',
            message: error instanceof Error ? error.message : 'Invalid bot slot config',
          }),
        );
      }
      return;
    }

    if (message.type === 'ping') {
      client.sendQueueBytes = ws.bufferedAmount;
      ws.send(encodeMessage({ type: 'pong', t: message.t }));
      return;
    }

    if (message.type === 'latency_report') {
      client.rttMs = Math.max(0, Math.round(message.rttMs));
      client.sendQueueBytes = ws.bufferedAmount;
      logClientLatency(client);
      sendRoomInfoDebounced();
      return;
    }
  }

  setInterval(() => logLatencySummary(clients), 10_000);

  startFixedTickLoop({
    hz: SERVER_TICK_HZ,
    onTick: () => {
      tickCounter += 1;
      const matchSnap = session.clock.snapshot();
      const lobbyIdle =
        !matchSnap.running || matchSnap.phase === 'setup' || matchSnap.phase === 'init';
      if (lobbyIdle && tickCounter % IDLE_TICK_STRIDE !== 0) {
        return;
      }

      for (const client of clients.values()) {
        if (!client.robotId) continue;
        const frame = client.input.peekLatest();
        if (frame) {
          session.applyInputFrame({ ...frame, robotId: client.robotId });
        }
      }

      session.step();

      for (const client of clients.values()) {
        client.input.clearEdges();
      }
      const afterSnap = session.clock.snapshot();
      broadcastAudioCues(prevMatchSnapshot, afterSnap);
      prevMatchSnapshot = afterSnap;

      const gateBurst = session.isGateReleaseInProgress();
      const activeSim = matchSnap.running && !matchSnap.paused && isActiveSimulationPhase(matchSnap.phase);
      const snapshotInterval = gateBurst ? 1 : SNAPSHOT_EVERY;
      if (tickCounter % snapshotInterval !== 0) return;

      const snapshot = session.buildNetSnapshot(MAX_SNAPSHOT_EVENTS);
      const hash = snapshotHash(snapshot);
      if (gateBurst || activeSim || hash !== lastSnapshotHash) {
        lastSnapshotHash = hash;
        broadcast(snapshot);
      }
    },
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[match-server] WebSocket listening on 0.0.0.0:${port}`);
    console.log(`[match-server] LAN address: ${lanAddress(port)}`);
    console.log(`[match-server] Sim tick ${SERVER_TICK_HZ} Hz · snapshots ${SNAPSHOT_HZ} Hz`);
  });
}

main().catch((error) => {
  console.error('[match-server] fatal:', error);
  process.exit(1);
});
