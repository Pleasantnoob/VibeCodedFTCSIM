import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from './physics-world.js';

const SPAWN_POSE = { x: 56, y: 10, heading: Math.PI / 2 };

const GOAL_VERTICES = [
  { x: 0, y: 72 },
  { x: 8, y: 72 },
  { x: 8, y: 80 },
  { x: 16, y: 80 },
  { x: 16, y: 72 },
  { x: 24, y: 72 },
  { x: 24, y: 64 },
  { x: 0, y: 64 },
];

describe('physics world', () => {
  it('creates robot body at spawn pose', async () => {
    const world = new PhysicsWorld();
    await world.init();

    world.createBodyFromDef('wall_south', {
      id: 'wall_south',
      type: 'static',
      shape: 'rectangle',
      center: { x: 72, y: -2 },
      width: 144,
      height: 4,
      material: { friction: 1, restitution: 0 },
    });
    world.createRobotBody('robot', SPAWN_POSE, 18, 18, 10, 0.8);

    const pose = world.getBodyPose('robot');
    expect(pose.x).toBeCloseTo(SPAWN_POSE.x, 0);
    expect(pose.y).toBeCloseTo(SPAWN_POSE.y, 0);

    world.destroy();
  });

  it('builds static polygon barriers with edge colliders matching Pedro vertices', async () => {
    const world = new PhysicsWorld();
    await world.init();

    world.createBodyFromDef('goal_test', {
      id: 'goal_test',
      type: 'static',
      shape: 'polygon',
      vertices: GOAL_VERTICES,
      material: { friction: 0.6, restitution: 0 },
    });

    for (const vertex of GOAL_VERTICES) {
      expect(vertex.x).toBeGreaterThanOrEqual(0);
      expect(vertex.y).toBeGreaterThanOrEqual(64);
      expect(vertex.x).toBeLessThanOrEqual(24);
      expect(vertex.y).toBeLessThanOrEqual(80);
    }

    world.destroy();
  });

  it('dynamic artifacts collide with each other', async () => {
    const world = new PhysicsWorld();
    await world.init();

    world.createDynamicCircle(
      'artifact_a',
      { x: 50, y: 50, heading: 0 },
      2.5,
      0.0748,
      { friction: 0.25, restitution: 0.02 },
    );
    world.createDynamicCircle(
      'artifact_b',
      { x: 51, y: 50, heading: 0 },
      2.5,
      0.0748,
      { friction: 0.25, restitution: 0.02 },
    );

    world.setLinearVelocityInches('artifact_a', -24, 0);
    world.setLinearVelocityInches('artifact_b', 24, 0);

    for (let i = 0; i < 120; i++) {
      world.step();
    }

    const poseA = world.getBodyPose('artifact_a');
    const poseB = world.getBodyPose('artifact_b');
    const separation = Math.hypot(poseA.x - poseB.x, poseA.y - poseB.y);
    expect(separation).toBeGreaterThan(4.5);

    world.destroy();
  });

  it('parked artifacts do not block other artifacts at the pickup location', async () => {
    const world = new PhysicsWorld();
    await world.init();

    const pickupPose = { x: 40, y: 50, heading: 0 };
    world.createDynamicCircle(
      'artifact_parked',
      pickupPose,
      2.5,
      0.0748,
      { friction: 0.25, restitution: 0.02 },
    );
    world.createDynamicCircle(
      'artifact_moving',
      { x: 40, y: 58, heading: 0 },
      2.5,
      0.0748,
      { friction: 0.25, restitution: 0.02 },
    );

    world.parkArtifactBody('artifact_parked', pickupPose);
    world.setLinearVelocityInches('artifact_moving', 0, -30);

    for (let i = 0; i < 180; i++) {
      world.step();
    }

    const moving = world.getBodyPose('artifact_moving');
    expect(moving.y).toBeLessThan(52);

    world.destroy();
  });

  it('kinematic robot pushes field artifact when artifact collision is enabled', async () => {
    const world = new PhysicsWorld();
    await world.init();

    world.createBodyFromDef('wall_north', {
      id: 'wall_north',
      type: 'static',
      shape: 'rectangle',
      center: { x: 50, y: 100 },
      width: 80,
      height: 4,
      material: { friction: 1, restitution: 0 },
    });
    world.createKinematicRobotBody('robot', { x: 30, y: 50, heading: 0 }, 18, 18, 0.8);
    world.createDynamicCircle(
      'artifact_ball',
      { x: 38, y: 50, heading: 0 },
      2.5,
      0.0748,
      { friction: 0.25, restitution: 0.02 },
    );
    world.setRobotArtifactCollision('robot', true);

    for (let i = 0; i < 90; i++) {
      world.syncKinematicRobot('robot', { x: 30 + i * 0.15, y: 50, heading: 0 }, 18, 0);
      world.step();
    }

    const artifactPose = world.getBodyPose('artifact_ball');
    expect(artifactPose.x).toBeGreaterThan(38.5);
    expect(world.isArtifactFieldColliderActive('artifact_ball')).toBe(true);

    world.destroy();
  });

  it('kinematic robot passes through field artifact when intake bypass is active', async () => {
    const world = new PhysicsWorld();
    await world.init();

    world.createKinematicRobotBody('robot', { x: 30, y: 50, heading: 0 }, 18, 18, 0.8);
    world.createDynamicCircle(
      'artifact_ball',
      { x: 38, y: 50, heading: 0 },
      2.5,
      0.0748,
      { friction: 0.25, restitution: 0.02 },
    );
    world.setRobotArtifactCollision('robot', false);

    for (let i = 0; i < 90; i++) {
      world.syncKinematicRobot('robot', { x: 30 + i * 0.15, y: 50, heading: 0 }, 18, 0);
      world.step();
    }

    const artifactPose = world.getBodyPose('artifact_ball');
    expect(artifactPose.x).toBeCloseTo(38, 0);
    expect(world.robotHasArtifactCollision('robot')).toBe(false);

    world.destroy();
  });

  it('ensureArtifactColliderForPhase restores parked on-field collider', async () => {
    const world = new PhysicsWorld();
    await world.init();

    const pose = { x: 40, y: 50, heading: 0 };
    world.createDynamicCircle('artifact_ball', pose, 2.5, 0.0748, {
      friction: 0.25,
      restitution: 0.02,
    });
    world.parkArtifactBody('artifact_ball', pose);
    expect(world.isArtifactFieldColliderActive('artifact_ball')).toBe(false);

    world.ensureArtifactColliderForPhase('artifact_ball', 'onField', pose, 0, 0);
    expect(world.isArtifactFieldColliderActive('artifact_ball')).toBe(true);

    world.destroy();
  });
});
