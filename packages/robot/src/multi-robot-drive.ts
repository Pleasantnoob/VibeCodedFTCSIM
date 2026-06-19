import type { Pose, Vector2 } from '@ftc-sim/field';
import { resolveMutualRobotCollisions, type MutableRobotBody } from './barrier-collision.js';
import type { DriveFrame, HolonomicInput, KinematicLimits, RobotFootprint } from './types.js';
import { stepVelocityDrive } from './velocity-drive.js';

const NPC_IDLE_INPUT: HolonomicInput = { forward: 0, strafe: 0, turn: 0 };

export interface NpcDriveState {
  id: string;
  pose: Pose;
  linear: Vector2;
  angular: number;
  width: number;
  length: number;
}

export interface MultiRobotDriveParams {
  player: {
    pose: Pose;
    linear: Vector2;
    angular: number;
    input: HolonomicInput;
  };
  npcs: NpcDriveState[];
  /** Per-NPC holonomic input keyed by robot id; omitted slots stay idle. */
  npcInputs?: Record<string, HolonomicInput>;
  dt: number;
  limits: KinematicLimits;
  footprint: RobotFootprint;
  barriers: Vector2[][];
  fieldSizeInches: number;
  driveFrame: DriveFrame;
  maxAcceleration: number;
  maxAngularAcceleration: number;
}

export interface MultiRobotDriveResult {
  player: { pose: Pose; linear: Vector2; angular: number };
  npcs: NpcDriveState[];
}

export function stepMultiRobotDrive(params: MultiRobotDriveParams): MultiRobotDriveResult {
  const {
    dt,
    limits,
    footprint,
    barriers,
    fieldSizeInches,
    driveFrame,
    maxAcceleration,
    maxAngularAcceleration,
  } = params;

  const playerNext = stepVelocityDrive({
    pose: params.player.pose,
    linear: params.player.linear,
    angular: params.player.angular,
    input: params.player.input,
    dt,
    limits,
    footprint,
    barriers,
    fieldSizeInches,
    driveFrame,
    maxAcceleration,
    maxAngularAcceleration,
  });

  const npcResults = params.npcs.map((npc) => {
    const npcFootprint = { width: npc.width, length: npc.length };
    const npcInput = params.npcInputs?.[npc.id] ?? NPC_IDLE_INPUT;
    const next = stepVelocityDrive({
      pose: npc.pose,
      linear: npc.linear,
      angular: npc.angular,
      input: npcInput,
      dt,
      limits,
      footprint: npcFootprint,
      barriers,
      fieldSizeInches,
      driveFrame: 'field',
      maxAcceleration,
      maxAngularAcceleration,
    });
    return {
      ...npc,
      pose: next.pose,
      linear: next.linear,
      angular: next.angular,
    };
  });

  const bodies: MutableRobotBody[] = [
    {
      pose: playerNext.pose,
      linear: playerNext.linear,
      angular: playerNext.angular,
      footprint,
    },
    ...npcResults.map((npc) => ({
      pose: npc.pose,
      linear: npc.linear,
      angular: npc.angular,
      footprint: { width: npc.width, length: npc.length },
    })),
  ];

  resolveMutualRobotCollisions(bodies);

  return {
    player: {
      pose: bodies[0]!.pose,
      linear: bodies[0]!.linear,
      angular: bodies[0]!.angular,
    },
    npcs: npcResults.map((npc, index) => ({
      ...npc,
      pose: bodies[index + 1]!.pose,
      linear: bodies[index + 1]!.linear,
      angular: bodies[index + 1]!.angular,
    })),
  };
}
