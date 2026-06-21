import type { BotSlotConfig, BotWorldSnapshot } from '@ftc-sim/bot';
import type { Alliance } from '@ftc-sim/game-decode';
import type { MatchState } from '@ftc-sim/game-decode';
import type { FieldDefinition, Pose, Vector2 } from '@ftc-sim/field';
import type { MatchSnapshot } from '@ftc-sim/match';
import type { StoredArtifact } from '@ftc-sim/mechanisms';
import type { KinematicLimits, RobotFootprint } from '@ftc-sim/robot';
import { PLAYER_ROBOT_ID, allianceForClaimableSlot, isClaimableRobotId } from './match-robots.js';
import { simRobotFootprint, simRobotLimits } from './robot-config.js';
import type { SimSession } from './sim-session.js';

export interface BotWebSnapshotContext {
  tickIndex: number;
  match: MatchSnapshot;
  field: FieldDefinition;
  playerAlliance: Alliance;
  playerPose: Pose;
  playerLinear: Vector2;
  playerAngular: number;
  playerStored: StoredArtifact[];
  npcRobots: Array<{
    id: string;
    alliance: Alliance;
    pose: Pose;
    linear: Vector2;
    angular: number;
    stored: StoredArtifact[];
  }>;
  artifacts: BotWorldSnapshot['artifacts'];
  gameState: MatchState | null;
  barriers: Vector2[][];
  robotConfig: {
    mass: number;
    maxAcceleration: number;
    maxAngularAcceleration: number;
  };
  footprint: RobotFootprint;
  limits: KinematicLimits;
  humanInputRobotIds?: ReadonlySet<string>;
  botSlots?: BotSlotConfig[];
}

/** Sole snapshot builder for solo web loop and SimSession integration. */
export function buildBotWorldSnapshot(
  session: SimSession,
  humanInputRobotIds: ReadonlySet<string>,
  botSlots: BotSlotConfig[],
): BotWorldSnapshot {
  const state = session.getState();
  const mechanism = session.getMechanismSnapshot();
  const robotConfig = session.getRobotConfig();
  const footprint = simRobotFootprint(robotConfig);
  const limits = simRobotLimits(robotConfig);
  const playerAlliance = session.getPlayerAlliance();

  const robots = state.fieldRobots.map((robot) => {
    const stored =
      mechanism.byRobot[robot.id]?.stored ??
      (robot.id === PLAYER_ROBOT_ID ? mechanism.stored : []);
    const motion =
      robot.id === PLAYER_ROBOT_ID
        ? { linear: state.linear, angular: state.angular }
        : state.npcRobots.find((npc) => npc.id === robot.id) ?? {
            linear: { x: 0, y: 0 },
            angular: 0,
          };
    return {
      id: robot.id,
      alliance: robot.alliance,
      pose: { ...robot.pose },
      linear: { ...motion.linear },
      angular: motion.angular,
      stored: [...stored],
    };
  });

  if (!robots.some((robot) => robot.id === PLAYER_ROBOT_ID)) {
    robots.unshift({
      id: PLAYER_ROBOT_ID,
      alliance: playerAlliance,
      pose: { ...state.pose },
      linear: { ...state.linear },
      angular: state.angular,
      stored: [...mechanism.stored],
    });
  }

  return assembleSnapshot({
    tickIndex: state.tickIndex,
    match: state.matchSnapshot,
    field: session.getField(),
    robots,
    artifacts: state.liveArtifacts.map((artifact) => ({
      id: artifact.id,
      color: artifact.color,
      phase: artifact.phase,
      pose: { ...artifact.pose },
      source: artifact.source,
    })),
    gameState: state.matchGameState,
    barriers: session.getBarrierPolygons(),
    footprint,
    limits,
    robotMass: robotConfig.mass,
    maxAcceleration: robotConfig.maxAcceleration,
    maxAngularAcceleration: robotConfig.maxAngularAcceleration,
    humanInputRobotIds,
    botSlots,
  });
}

export function buildBotWorldSnapshotFromWebContext(
  ctx: BotWebSnapshotContext,
): BotWorldSnapshot {
  return assembleSnapshot({
    tickIndex: ctx.tickIndex,
    match: ctx.match,
    field: ctx.field,
    robots: [
      {
        id: PLAYER_ROBOT_ID,
        alliance: ctx.playerAlliance,
        pose: ctx.playerPose,
        linear: ctx.playerLinear,
        angular: ctx.playerAngular,
        stored: ctx.playerStored,
      },
      ...ctx.npcRobots,
    ],
    artifacts: ctx.artifacts,
    gameState: ctx.gameState,
    barriers: ctx.barriers,
    footprint: ctx.footprint,
    limits: ctx.limits,
    robotMass: ctx.robotConfig.mass,
    maxAcceleration: ctx.robotConfig.maxAcceleration,
    maxAngularAcceleration: ctx.robotConfig.maxAngularAcceleration,
    humanInputRobotIds: ctx.humanInputRobotIds ?? new Set([PLAYER_ROBOT_ID]),
    botSlots: ctx.botSlots ?? [],
  });
}

/** @deprecated Use buildBotWorldSnapshotFromWebContext */
export function buildBotWorldSnapshotFromParts(
  parts: Omit<BotWorldSnapshot, 'humanInputRobotIds' | 'botSlots'> & {
    humanInputRobotIds?: ReadonlySet<string>;
    botSlots?: BotSlotConfig[];
  },
): BotWorldSnapshot {
  return assembleSnapshot(parts);
}

function assembleSnapshot(
  parts: Omit<BotWorldSnapshot, 'humanInputRobotIds' | 'botSlots'> & {
    humanInputRobotIds?: ReadonlySet<string>;
    botSlots?: BotSlotConfig[];
  },
): BotWorldSnapshot {
  return {
    ...parts,
    humanInputRobotIds: parts.humanInputRobotIds ?? new Set<string>(),
    botSlots: parts.botSlots ?? [],
  };
}

export function allianceForRobotId(robotId: string, playerAlliance: Alliance): Alliance {
  if (robotId === PLAYER_ROBOT_ID) return playerAlliance;
  if (isClaimableRobotId(robotId)) {
    return allianceForClaimableSlot(robotId);
  }
  return playerAlliance;
}
