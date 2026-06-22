import type { Pose } from '@ftc-sim/field';
import { FIELD_SIZE_INCHES, mirrorX, normalizeAngle } from '@ftc-sim/field';
import { robotCorners } from '@ftc-sim/robot';
import type { MatchRobotSnapshot } from '@ftc-sim/game-decode';
import type { NpcDriveState } from '@ftc-sim/robot';

export interface NpcMotionState extends NpcDriveState {
  alliance: MatchAlliance;
  teamNumber: string;
}

export type MatchAlliance = 'blue' | 'red';

/** Mirror blue-authored pose across field center (x = 72) for red alliance. */
function mirrorPedroPose(pose: Pose): Pose {
  return {
    x: mirrorX(pose.x, FIELD_SIZE_INCHES),
    y: pose.y,
    heading: normalizeAngle(Math.PI - pose.heading),
  };
}

/** Blue alliance near launch (top of field, y ≈ 124). */
export const BLUE_NEAR_SPAWN: Pose = {
  x: 22,
  y: 124,
  heading: (144 * Math.PI) / 180,
};

/** Blue alliance far launch (bottom of field, y ≈ 8). */
export const BLUE_FAR_SPAWN: Pose = {
  x: 56,
  y: 8,
  heading: Math.PI / 2,
};

/** Red far-side start — mirror of {@link BLUE_FAR_SPAWN}. */
export const RED_FAR_SPAWN: Pose = mirrorPedroPose(BLUE_FAR_SPAWN);

/** Near-field alliance starts (inches, Pedro coords). Red mirrors blue. */
export const ALLIANCE_NEAR_SPAWN: Record<MatchAlliance, Pose> = {
  blue: BLUE_NEAR_SPAWN,
  red: mirrorPedroPose(BLUE_NEAR_SPAWN),
};

/** Red near start — mirror of blue near. */
export const RED_NEAR_SPAWN: Pose = ALLIANCE_NEAR_SPAWN.red;

/** Centered in BASE zone (18×18″) for endgame parking reference. */
export const RED_BASE_PARK: Pose = { x: 33, y: 33, heading: Math.PI / 2 };
export const BLUE_BASE_PARK: Pose = { x: 105, y: 33, heading: Math.PI / 2 };

export interface PracticeTeamNumbers {
  blueNear: string;
  blueFar: string;
  redNear: string;
  redFar: string;
}

export const DEFAULT_PRACTICE_TEAMS: PracticeTeamNumbers = {
  blueNear: '-3',
  blueFar: '-4',
  redNear: '-1',
  redFar: '-2',
};

export interface MatchRobotLayout extends FieldRobotCatalogEntry {
  pose: Pose;
}

export interface FieldRobotCatalogEntry {
  id: string;
  alliance: MatchAlliance;
  teamNumber: string;
  width: number;
  length: number;
}

export interface FieldRobotRenderState extends FieldRobotCatalogEntry {
  pose: Pose;
}

export const PLAYER_ROBOT_ID = 'player';

/** Robot slots each player can claim in the lobby (ids match field near/far positions). */
export const CLAIMABLE_ROBOT_IDS = ['player', 'blue-near', 'red-far', 'red-near'] as const;
export type ClaimableRobotId = (typeof CLAIMABLE_ROBOT_IDS)[number];

export function isClaimableRobotId(id: string): id is ClaimableRobotId {
  return (CLAIMABLE_ROBOT_IDS as readonly string[]).includes(id);
}

/** Lobby labels (field top = near launch, bottom = far launch). */
export const ROBOT_SLOT_LABELS: Record<ClaimableRobotId, string> = {
  player: 'Blue far',
  'blue-near': 'Blue near',
  'red-far': 'Red far',
  'red-near': 'Red near',
};

/** Spawn pose when a lobby slot is claimed. */
export function spawnPoseForClaimableSlot(id: ClaimableRobotId): Pose {
  switch (id) {
    case 'player':
      return BLUE_FAR_SPAWN;
    case 'blue-near':
      return ALLIANCE_NEAR_SPAWN.blue;
    case 'red-far':
      return RED_FAR_SPAWN;
    case 'red-near':
      return RED_NEAR_SPAWN;
  }
}

export function allianceForClaimableSlot(id: ClaimableRobotId): MatchAlliance {
  switch (id) {
    case 'player':
    case 'blue-near':
      return 'blue';
    case 'red-far':
    case 'red-near':
      return 'red';
  }
}

/** Display order in lobby grid (blue top row, red bottom row). */
export const LOBBY_SLOT_ORDER: ClaimableRobotId[] = ['player', 'blue-near', 'red-far', 'red-near'];

/** Solo practice spawn corners (alliance + near/far launch). */
export type SoloSpawnSlot = 'blue-near' | 'blue-far' | 'red-near' | 'red-far';

export const SOLO_SPAWN_SLOTS: SoloSpawnSlot[] = ['blue-near', 'blue-far', 'red-near', 'red-far'];

export const SOLO_SPAWN_LABELS: Record<SoloSpawnSlot, string> = {
  'blue-near': 'Blue near',
  'blue-far': 'Blue far',
  'red-near': 'Red near',
  'red-far': 'Red far',
};

export function allianceForSpawnSlot(slot: SoloSpawnSlot): MatchAlliance {
  return slot.startsWith('blue') ? 'blue' : 'red';
}

export function playerSpawnPose(slot: SoloSpawnSlot = 'blue-far'): Pose {
  switch (slot) {
    case 'blue-near':
      return ALLIANCE_NEAR_SPAWN.blue;
    case 'blue-far':
      return BLUE_FAR_SPAWN;
    case 'red-near':
      return RED_NEAR_SPAWN;
    case 'red-far':
      return RED_FAR_SPAWN;
  }
}

/** Practice / net slots driven by a human — bots must not control these ids. */
export function humanOccupiedRobotIds(options: {
  spawnSlot?: SoloSpawnSlot;
  netRobotId?: string | null;
} = {}): Set<string> {
  const ids = new Set<string>([PLAYER_ROBOT_ID]);
  if (options.netRobotId && isClaimableRobotId(options.netRobotId)) {
    ids.add(options.netRobotId);
    return ids;
  }
  switch (options.spawnSlot) {
    case 'blue-near':
      ids.add('blue-near');
      break;
    case 'red-near':
      ids.add('red-near');
      break;
    case 'red-far':
      ids.add('red-far');
      break;
    default:
      break;
  }
  return ids;
}

/** Non-controlled robots for a practice 2v2 field. */
export function practiceFieldRobots(
  footprint: { width: number; length: number },
  teams: PracticeTeamNumbers = DEFAULT_PRACTICE_TEAMS,
): MatchRobotLayout[] {
  return [
    {
      id: 'blue-near',
      alliance: 'blue',
      teamNumber: teams.blueNear,
      pose: ALLIANCE_NEAR_SPAWN.blue,
      width: footprint.width,
      length: footprint.length,
    },
    {
      id: 'red-far',
      alliance: 'red',
      teamNumber: teams.redFar,
      pose: RED_FAR_SPAWN,
      width: footprint.width,
      length: footprint.length,
    },
    {
      id: 'red-near',
      alliance: 'red',
      teamNumber: teams.redNear,
      pose: RED_NEAR_SPAWN,
      width: footprint.width,
      length: footprint.length,
    },
  ];
}

export function buildFieldRobotCatalog(
  practiceRobots: MatchRobotLayout[],
  player: { alliance: MatchAlliance; teamNumber: string; width: number; length: number },
): FieldRobotCatalogEntry[] {
  return [
    {
      id: PLAYER_ROBOT_ID,
      alliance: player.alliance,
      teamNumber: player.teamNumber,
      width: player.width,
      length: player.length,
    },
    ...practiceRobots.map(({ id, alliance, teamNumber, width, length }) => ({
      id,
      alliance,
      teamNumber,
      width,
      length,
    })),
  ];
}

export function buildFieldRobotRenderStates(
  playerPose: Pose,
  playerAlliance: MatchAlliance,
  playerTeamNumber: string,
  footprint: { width: number; length: number },
  npcRobots: NpcMotionState[],
): FieldRobotRenderState[] {
  return [
    {
      id: PLAYER_ROBOT_ID,
      alliance: playerAlliance,
      teamNumber: playerTeamNumber,
      width: footprint.width,
      length: footprint.length,
      pose: playerPose,
    },
    ...npcRobots.map((npc) => ({
      id: npc.id,
      alliance: npc.alliance,
      teamNumber: npc.teamNumber,
      width: npc.width,
      length: npc.length,
      pose: npc.pose,
    })),
  ];
}

export function createNpcMotionStates(layouts: MatchRobotLayout[]): NpcMotionState[] {
  return layouts.map((layout) => ({
    id: layout.id,
    alliance: layout.alliance,
    teamNumber: layout.teamNumber,
    pose: { ...layout.pose },
    linear: { x: 0, y: 0 },
    angular: 0,
    width: layout.width,
    length: layout.length,
  }));
}

export function matchRobotSnapshots(
  playerPose: Pose,
  playerAlliance: MatchAlliance,
  npcRobots: NpcMotionState[],
  footprint: { width: number; length: number },
): MatchRobotSnapshot[] {
  const fp = { width: footprint.width, length: footprint.length };
  return [
    {
      id: PLAYER_ROBOT_ID,
      alliance: playerAlliance,
      footprint: robotCorners(playerPose, fp),
    },
    ...npcRobots.map((robot) => ({
      id: robot.id,
      alliance: robot.alliance,
      footprint: robotCorners(robot.pose, { width: robot.width, length: robot.length }),
    })),
  ];
}
