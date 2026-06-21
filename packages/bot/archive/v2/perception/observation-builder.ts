import type { BotObservation, BotRobotSnapshot, BotWorldSnapshot } from '../types.js';

export function buildObservation(
  world: BotWorldSnapshot,
  robotId: string,
): BotObservation | null {
  const self = world.robots.find((robot) => robot.id === robotId);
  if (!self) return null;

  const allies = world.robots.filter(
    (robot) => robot.alliance === self.alliance && robot.id !== robotId,
  );
  const opponents = world.robots.filter((robot) => robot.alliance !== self.alliance);

  const motif = world.gameState?.obeliskMotif ?? '21';
  const rampOccupancy = world.gameState?.rampOccupancy ?? {
    red: Array(9).fill(null),
    blue: Array(9).fill(null),
  };
  const gateOpen = world.gameState?.gateOpen ?? { red: false, blue: false };
  const scores = {
    blue: world.gameState?.byAlliance.blue.score.total ?? 0,
    red: world.gameState?.byAlliance.red.score.total ?? 0,
  };

  return {
    tick: world.tickIndex,
    self,
    allies,
    opponents,
    artifacts: world.artifacts,
    match: {
      phase: world.match.phase,
      timeElapsed: world.match.timeElapsed,
      timeRemainingInPhase: world.match.timeRemainingInPhase,
      infiniteMode: world.match.infiniteMode,
      allowsDrive: world.match.allowsDrive,
      controlSource: world.match.controlSource,
      running: world.match.running,
      paused: world.match.paused,
    },
    game: { motif, rampOccupancy, gateOpen, scores },
    barriers: world.barriers,
    field: world.field,
    footprint: world.footprint,
    limits: world.limits,
    maxAcceleration: world.maxAcceleration,
    maxAngularAcceleration: world.maxAngularAcceleration,
  };
}

export function findRobot(world: BotWorldSnapshot, robotId: string): BotRobotSnapshot | undefined {
  return world.robots.find((robot) => robot.id === robotId);
}
