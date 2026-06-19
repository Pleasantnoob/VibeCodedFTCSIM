export type { MechanismCommand, MechanismSnapshot, SimArtifactState, MechanismLogEntry } from './types.js';
export type { MechanismLogCategory } from './mechanism-log.js';
export { MechanismLogger } from './mechanism-log.js';
export { MAX_STORAGE, INTAKE_ACTIVE_THRESHOLD, SHOOT_HOLD_INTERVAL_S } from './types.js';
export {
  artifactTouchesFrontEdge,
  detectArtifactStuckInStructure,
  frontEdgeCenter,
  frontEdgeSegment,
  humanPlayerRespawnPose,
  isOutOfFieldBounds,
  planShot,
  rampOutwardSpawnPose,
  rampSlotPositions,
  rampSouthExitPose,
  robotFootprintCorners,
  robotForwardUnit,
  robotInGateZone,
  robotInLaunchZone,
} from './geometry.js';
export { ArtifactSimulation, type PhysicsAdapter } from './artifact-simulation.js';
