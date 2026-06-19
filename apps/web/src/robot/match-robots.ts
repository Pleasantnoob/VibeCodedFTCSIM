import type { Pose } from '@ftc-sim/field';
import { robotCorners } from '@ftc-sim/robot';
import type { MatchRobotSnapshot } from '@ftc-sim/game-decode';
import type { NpcDriveState } from '@ftc-sim/robot';

export interface NpcMotionState extends NpcDriveState {
  alliance: MatchAlliance;
  teamNumber: string;
}

export type MatchAlliance = 'blue' | 'red';

/** Blue alliance far-side start (human player station corner). Heading in degrees. */
export const BLUE_FAR_SPAWN: Pose = {
  x: 22,
  y: 124,
  heading: (144 * Math.PI) / 180,
};

/** Near-field alliance starts (inches, Pedro coords). */
export const ALLIANCE_NEAR_SPAWN: Record<MatchAlliance, Pose> = {
  blue: { x: 56, y: 8, heading: Math.PI / 2 },
  red: { x: 86, y: 8, heading: Math.PI / 2 },
};

/** Centered in BASE zone (18×18″) for parked practice robots. */
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

export function playerSpawnPose(): Pose {
  return BLUE_FAR_SPAWN;
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
      id: 'red-near',
      alliance: 'red',
      teamNumber: teams.redNear,
      pose: RED_BASE_PARK,
      width: footprint.width,
      length: footprint.length,
    },
    {
      id: 'red-far',
      alliance: 'red',
      teamNumber: teams.redFar,
      pose: BLUE_BASE_PARK,
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
