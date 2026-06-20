import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
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
} from '@ftc-sim/net';
import { getDecodeField, getMatchArtifactStaging } from '@ftc-sim/season-decode';
import {
  DEFAULT_PRACTICE_TEAMS,
  isClaimableRobotId,
  playerSpawnPose,
  practiceFieldRobots,
  SimSession,
  simRobotFootprint,
  DEFAULT_SIM_ROBOT_CONFIG,
} from '@ftc-sim/session';

import { startFixedTickLoop } from './tick-loop.js';

const APP_VERSION = '0.2.0';
const SNAPSHOT_EVERY = Math.round(SERVER_TICK_HZ / SNAPSHOT_HZ);
const MAX_CLIENTS = 8;
const MAX_SNAPSHOT_EVENTS = 20;

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

async function main(): Promise<void> {
  const port = Number(process.env.MATCH_PORT ?? DEFAULT_MATCH_PORT);
  const session = buildSession();
  await session.init();

  const clients = new Map<WebSocket, ClientRecord>();
  let nextClientId = 1;
  let hostClient: ClientRecord | null = null;

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
    sendRoomInfo();
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
      }
      if (client === hostClient) {
        hostClient = null;
        broadcast({ type: 'match_ended', reason: 'host_disconnected' });
      }
      console.log(`[match-server] left ${client.name} (${client.id})`);
      sendRoomInfo();
    });
  });

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

      const field = getDecodeField();
      const barriers = getBarrierBodies(field).map((body) => ({
        id: body.id,
        vertices: getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
      }));

      ws.send(
        encodeMessage({
          type: 'welcome',
          playerId: record.id,
          role: record.role,
          robotId: record.robotId,
          roomConfig: {
            alliance: 'blue',
            barrierHash: hashBarriers(barriers),
            artifactFriction: 0.25,
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
        sendRoomInfo();
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
      session.applyHostCommand(message.cmd);
      broadcast(session.buildNetSnapshot(MAX_SNAPSHOT_EVENTS));
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
      sendRoomInfo();
      return;
    }
  }

  setInterval(() => logLatencySummary(clients), 10_000);

  let tickCounter = 0;
  startFixedTickLoop({
    hz: SERVER_TICK_HZ,
    onTick: () => {
      session.clearRobotInputs();
      for (const client of clients.values()) {
        if (!client.robotId) continue;
        const frame = client.input.consume();
        if (frame) {
          session.applyInputFrame({ ...frame, robotId: client.robotId });
        }
      }

      session.step();
      tickCounter += 1;

      if (tickCounter % SNAPSHOT_EVERY === 0) {
        broadcast(session.buildNetSnapshot(MAX_SNAPSHOT_EVENTS));
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
