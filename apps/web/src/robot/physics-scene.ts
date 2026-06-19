import type { FieldBodyDefinition, FieldDefinition, Pose } from '@ftc-sim/field';
import { physicsLog, type PhysicsWorld } from '@ftc-sim/physics';
import { robotCorners, type KinematicRobotConfig } from '@ftc-sim/robot';
import type { EditableBarrier } from '../field/barrier-editor';

export const ROBOT_BODY_ID = 'robot';
export const ROBOT_MASS_KG = 10;

export function barrierToBodyDef(barrier: EditableBarrier): FieldBodyDefinition {
  return {
    id: barrier.id,
    type: 'static',
    shape: 'polygon',
    vertices: barrier.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    material: { friction: 0.6, restitution: 0 },
    label: barrier.label,
  };
}

function resolveSpawnPose(pose: Pose, config: KinematicRobotConfig): Pose {
  const corners = robotCorners(pose, config.footprint);
  const minY = Math.min(...corners.map((corner) => corner.y));
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const maxY = Math.max(...corners.map((corner) => corner.y));
  const margin = 0.5;
  let next = pose;

  if (minY < margin) {
    const delta = margin - minY;
    physicsLog.warn(
      `Spawn (${pose.x}, ${pose.y}) bottom at y=${minY.toFixed(2)}″ — nudging north +${delta.toFixed(2)}″`,
    );
    next = { ...next, y: pose.y + delta };
  }
  if (minX < margin || maxX > 144 - margin || maxY > 144 - margin) {
    physicsLog.warn(
      `Spawn footprint x=[${minX.toFixed(1)}, ${maxX.toFixed(1)}] y=[${minY.toFixed(1)}, ${maxY.toFixed(1)}] near field edge`,
    );
  }

  return next;
}

export function buildPhysicsScene(
  world: PhysicsWorld,
  field: FieldDefinition,
  barriers: EditableBarrier[],
  startPose: Pose,
  config: KinematicRobotConfig,
): Pose {
  physicsLog.clear();
  physicsLog.info('Building physics scene…');

  for (const body of field.bodies) {
    if (body.id.startsWith('wall_')) {
      world.createBodyFromDef(body.id, body);
    }
  }

  for (const barrier of barriers) {
    world.createBodyFromDef(barrier.id, barrierToBodyDef(barrier));
  }

  const spawnPose = resolveSpawnPose(startPose, config);
  world.createRobotBody(
    ROBOT_BODY_ID,
    spawnPose,
    config.footprint.width,
    config.footprint.length,
    ROBOT_MASS_KG,
    0.8,
  );

  for (let i = 0; i < 2; i++) {
    world.step();
  }

  const settled = world.getBodyPose(ROBOT_BODY_ID);
  physicsLog.info(
    `Robot settled at (${settled.x.toFixed(2)}, ${settled.y.toFixed(2)}) heading ${((settled.heading * 180) / Math.PI).toFixed(1)}°`,
  );

  return settled;
}
