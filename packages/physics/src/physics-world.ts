import RAPIER from '@dimforge/rapier2d-compat';
import type { FieldBodyDefinition, FieldDefinition, Pose, Vector2 } from '@ftc-sim/field';
import {
  INCHES_TO_METERS,
  pedroPointToPhysics,
  pedroToPhysics,
  physicsToPedro,
} from '@ftc-sim/field';
import { physicsLog } from './physics-log.js';
import { ensureCounterClockwise } from './polygon-mesh.js';

export interface PhysicsConfig {
  timestep: number;
  gravity: number;
  deterministic: boolean;
}

export interface BodyHandle {
  id: string;
  handle: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface ForceTorque {
  fx: number;
  fy: number;
  torque: number;
}

const DEFAULT_CONFIG: PhysicsConfig = {
  timestep: 1 / 120,
  gravity: 0,
  deterministic: true,
};

/** Rapier collision membership / filter groups (lower 16 = filter, upper 16 = membership). */
export const PHYSICS_GROUP_ROBOT = 0x0001;
export const PHYSICS_GROUP_ARTIFACT = 0x0002;
export const PHYSICS_GROUP_STATIC = 0x0004;

function collisionGroups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

const STATIC_COLLISION_GROUPS = collisionGroups(
  PHYSICS_GROUP_STATIC,
  PHYSICS_GROUP_ROBOT | PHYSICS_GROUP_ARTIFACT,
);
const ROBOT_COLLISION_GROUPS = collisionGroups(
  PHYSICS_GROUP_ROBOT,
  PHYSICS_GROUP_ARTIFACT | PHYSICS_GROUP_STATIC,
);
const ARTIFACT_COLLISION_GROUPS = collisionGroups(
  PHYSICS_GROUP_ARTIFACT,
  PHYSICS_GROUP_ROBOT | PHYSICS_GROUP_STATIC | PHYSICS_GROUP_ARTIFACT,
);
/** Parked artifacts (held, in flight, on ramp) collide with nothing. */
const PARKED_COLLISION_GROUPS = collisionGroups(0, 0);

export class PhysicsWorld {
  private world!: RAPIER.World;
  private eventQueue!: RAPIER.EventQueue;
  private bodies = new Map<string, BodyHandle>();
  private config: PhysicsConfig;
  private initialized = false;
  private pendingForces = new Map<string, ForceTorque>();

  constructor(config: Partial<PhysicsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: this.config.gravity });
    this.world.integrationParameters.dt = this.config.timestep;
    this.world.integrationParameters.numSolverIterations = 12;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.initialized = true;
  }

  get timestep(): number {
    return this.config.timestep;
  }

  buildField(field: FieldDefinition): void {
    for (const bodyDef of field.bodies) {
      this.createBodyFromDef(bodyDef.id, bodyDef);
    }
  }

  createBodyFromDef(id: string, def: FieldBodyDefinition): BodyHandle {
    const isStatic = def.type === 'static';
    let bodyDesc: RAPIER.RigidBodyDesc;

    if (def.shape === 'circle' && def.radius != null && def.center) {
      const center = pedroPointToPhysics(def.center);
      bodyDesc = isStatic
        ? RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y)
        : RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(center.x, center.y)
            .setLinearDamping(0.1)
            .setAngularDamping(0.1);
      if (def.mass && !isStatic) bodyDesc.setAdditionalMass(def.mass);
    } else if (def.shape === 'rectangle' && def.width != null && def.height != null && def.center) {
      const center = pedroPointToPhysics(def.center);
      bodyDesc = isStatic
        ? RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y)
        : RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(center.x, center.y)
            .setLinearDamping(0.1)
            .setAngularDamping(0.1);
      if (def.mass && !isStatic) bodyDesc.setAdditionalMass(def.mass);
    } else if (def.shape === 'polygon' && def.vertices?.length) {
      const physicsVertsAbs = ensureCounterClockwise(def.vertices.map(pedroPointToPhysics));
      const len = physicsVertsAbs.length || 1;
      const cx = physicsVertsAbs.reduce((sum, v) => sum + v.x, 0) / len;
      const cy = physicsVertsAbs.reduce((sum, v) => sum + v.y, 0) / len;

      bodyDesc = isStatic
        ? RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy)
        : RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(cx, cy)
            .setLinearDamping(0.1)
            .setAngularDamping(0.1);
      if (def.mass && !isStatic) bodyDesc.setAdditionalMass(def.mass);
    } else {
      throw new Error(`Invalid body definition: ${id}`);
    }

    const body = this.world.createRigidBody(bodyDesc);
    let colliderDesc: RAPIER.ColliderDesc;

    if (def.shape === 'circle' && def.radius != null) {
      colliderDesc = RAPIER.ColliderDesc.ball(def.radius * INCHES_TO_METERS);
    } else if (def.shape === 'rectangle' && def.width != null && def.height != null) {
      colliderDesc = RAPIER.ColliderDesc.cuboid(
        (def.width * INCHES_TO_METERS) / 2,
        (def.height * INCHES_TO_METERS) / 2,
      );
    } else if (def.shape === 'polygon' && def.vertices?.length) {
      const physicsVertsAbs = ensureCounterClockwise(def.vertices.map(pedroPointToPhysics));
      const len = physicsVertsAbs.length || 1;
      const cx = physicsVertsAbs.reduce((sum, v) => sum + v.x, 0) / len;
      const cy = physicsVertsAbs.reduce((sum, v) => sum + v.y, 0) / len;

      // Rapier polygon vertices are in collider-local space, relative to the body's origin.
      const physicsVerts = physicsVertsAbs.map((v) => ({ x: v.x - cx, y: v.y - cy }));
      const pedroOutline = def.vertices.map((vertex) => `(${vertex.x},${vertex.y})`).join(' ');

      if (isStatic) {
        const edgeThickness = 0.02;
        const handle = this.createPolygonEdgeColliders(
          id,
          body,
          physicsVerts,
          def.material,
          edgeThickness,
        );
        physicsLog.info(
          `${id}: edge colliders ${physicsVerts.length} segments — ${pedroOutline}`,
        );
        return handle;
      }

      const flat = new Float32Array(physicsVerts.flatMap((vertex) => [vertex.x, vertex.y]));
      colliderDesc = RAPIER.ColliderDesc.convexHull(flat)!;
      physicsLog.info(`${id}: convex hull (${physicsVerts.length} verts) — ${pedroOutline}`);
    } else {
      throw new Error(`Invalid collider: ${id}`);
    }

    colliderDesc.setFriction(def.material.friction);
    colliderDesc.setRestitution(def.material.restitution ?? 0);
    if (def.material.density && !isStatic) {
      colliderDesc.setDensity(def.material.density);
    }
    if (isStatic) {
      colliderDesc.setCollisionGroups(STATIC_COLLISION_GROUPS);
    }

    const collider = this.world.createCollider(colliderDesc, body);
    const handle: BodyHandle = { id, handle: body, collider };
    this.bodies.set(id, handle);
    return handle;
  }

  private createPolygonEdgeColliders(
    id: string,
    body: RAPIER.RigidBody,
    localVerts: Vector2[],
    material: FieldBodyDefinition['material'],
    thicknessMeters: number,
  ): BodyHandle {
    let firstCollider: RAPIER.Collider | null = null;

    for (let i = 0; i < localVerts.length; i++) {
      const a = localVerts[i];
      const b = localVerts[(i + 1) % localVerts.length];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const halfLen = Math.hypot(dx, dy) / 2;
      if (halfLen < 1e-6) continue;

      const angle = Math.atan2(dy, dx);
      const segmentDesc = RAPIER.ColliderDesc.cuboid(halfLen, thicknessMeters / 2)
        .setTranslation(midX, midY)
        .setRotation(angle)
        .setFriction(material.friction)
        .setRestitution(material.restitution ?? 0)
        .setCollisionGroups(STATIC_COLLISION_GROUPS);

      const collider = this.world.createCollider(segmentDesc, body);
      if (!firstCollider) firstCollider = collider;
    }

    if (!firstCollider) {
      throw new Error(`Failed to build edge colliders for ${id}`);
    }

    const handle: BodyHandle = { id, handle: body, collider: firstCollider };
    this.bodies.set(id, handle);
    return handle;
  }

  createRobotBody(
    id: string,
    pose: Pose,
    widthInches: number,
    lengthInches: number,
    mass: number,
    friction: number,
  ): BodyHandle {
    const physicsPose = pedroToPhysics(pose);
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(physicsPose.x, physicsPose.y)
      .setRotation(physicsPose.heading)
      .setLinearDamping(0.05)
      .setAngularDamping(0.08)
      .setAdditionalMass(mass)
      .setCcdEnabled(true)
      .setCanSleep(true);

    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      (widthInches * INCHES_TO_METERS) / 2,
      (lengthInches * INCHES_TO_METERS) / 2,
    )
      .setFriction(Math.max(0.45, friction * 0.65))
      .setRestitution(0);

    const collider = this.world.createCollider(colliderDesc, body);
    const handle: BodyHandle = { id, handle: body, collider };
    this.bodies.set(id, handle);
    return handle;
  }

  createKinematicRobotBody(
    id: string,
    pose: Pose,
    widthInches: number,
    lengthInches: number,
    friction: number,
  ): BodyHandle {
    const physicsPose = pedroToPhysics(pose);
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(physicsPose.x, physicsPose.y)
      .setRotation(physicsPose.heading)
      .setCcdEnabled(true);

    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      (widthInches * INCHES_TO_METERS) / 2,
      (lengthInches * INCHES_TO_METERS) / 2,
    )
      .setFriction(Math.max(0.45, friction * 0.65))
      .setRestitution(0)
      .setCollisionGroups(ROBOT_COLLISION_GROUPS);

    const collider = this.world.createCollider(colliderDesc, body);
    const handle: BodyHandle = { id, handle: body, collider };
    this.bodies.set(id, handle);
    return handle;
  }

  createDynamicCircle(
    id: string,
    pose: Pose,
    radiusInches: number,
    massKg: number,
    material: { friction: number; restitution?: number },
  ): BodyHandle {
    const physicsPose = pedroToPhysics(pose);
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(physicsPose.x, physicsPose.y)
      .setLinearDamping(0.03)
      .setAngularDamping(0.2)
      .setAdditionalMass(massKg)
      .setCcdEnabled(true)
      .setCanSleep(true);

    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(radiusInches * INCHES_TO_METERS)
      .setFriction(material.friction)
      .setRestitution(material.restitution ?? 0.05)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setCollisionGroups(ARTIFACT_COLLISION_GROUPS);

    const collider = this.world.createCollider(colliderDesc, body);
    const handle: BodyHandle = { id, handle: body, collider };
    this.bodies.set(id, handle);
    return handle;
  }

  /** When false, robot collider ignores artifacts (intake running) but still hits walls. */
  setRobotArtifactCollision(id: string, enabled: boolean): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    const filter = enabled
      ? PHYSICS_GROUP_ARTIFACT | PHYSICS_GROUP_STATIC
      : PHYSICS_GROUP_STATIC;
    bodyHandle.collider.setCollisionGroups(collisionGroups(PHYSICS_GROUP_ROBOT, filter));
  }

  setBodyPose(id: string, pose: Pose): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    const physicsPose = pedroToPhysics(pose);
    bodyHandle.handle.setTranslation({ x: physicsPose.x, y: physicsPose.y }, true);
    bodyHandle.handle.setRotation(physicsPose.heading, true);
    bodyHandle.handle.setLinvel({ x: 0, y: 0 }, true);
    bodyHandle.handle.setAngvel(0, true);
  }

  getBodyPose(id: string): Pose {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return { x: 0, y: 0, heading: 0 };
    const translation = bodyHandle.handle.translation();
    const rotation = bodyHandle.handle.rotation();
    return physicsToPedro({ x: translation.x, y: translation.y, heading: rotation });
  }

  getBodyVelocity(id: string): { linear: Vector2; angular: number } {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return { linear: { x: 0, y: 0 }, angular: 0 };
    const velocity = bodyHandle.handle.linvel();
    return {
      linear: { x: velocity.x / INCHES_TO_METERS, y: velocity.y / INCHES_TO_METERS },
      angular: bodyHandle.handle.angvel(),
    };
  }

  applyForceTorque(id: string, forceTorque: ForceTorque): void {
    this.pendingForces.set(id, forceTorque);
  }

  dampRobot(id: string, factor: number): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle || bodyHandle.handle.isFixed()) return;
    const velocity = bodyHandle.handle.linvel();
    bodyHandle.handle.setLinvel(
      { x: velocity.x * factor, y: velocity.y * factor },
      true,
    );
    bodyHandle.handle.setAngvel(bodyHandle.handle.angvel() * factor, true);
  }

  stopRobot(id: string): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle || bodyHandle.handle.isFixed()) return;
    bodyHandle.handle.setLinvel({ x: 0, y: 0 }, true);
    bodyHandle.handle.setAngvel(0, true);
  }

  setBodyTranslation(id: string, xInches: number, yInches: number): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    const physicsPose = pedroToPhysics({ x: xInches, y: yInches, heading: 0 });
    bodyHandle.handle.setTranslation({ x: physicsPose.x, y: physicsPose.y }, true);
  }

  step(): void {
    for (const [id, forceTorque] of this.pendingForces) {
      const bodyHandle = this.bodies.get(id);
      if (!bodyHandle) continue;
      bodyHandle.handle.addForce({ x: forceTorque.fx, y: forceTorque.fy }, true);
      bodyHandle.handle.addTorque(forceTorque.torque, true);
    }
    this.pendingForces.clear();
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents(() => {});
  }

  settleDynamicBodies(): void {
    for (const bodyHandle of this.bodies.values()) {
      if (bodyHandle.handle.isFixed()) continue;
      bodyHandle.handle.setLinvel({ x: 0, y: 0 }, true);
      bodyHandle.handle.setAngvel(0, true);
    }
  }

  clampLinearSpeed(id: string, maxInchesPerSec: number): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle || bodyHandle.handle.isFixed()) return;
    const velocity = bodyHandle.handle.linvel();
    const speedMps = Math.hypot(velocity.x, velocity.y);
    const maxMps = maxInchesPerSec * INCHES_TO_METERS;
    if (speedMps <= maxMps) return;
    const scale = maxMps / speedMps;
    bodyHandle.handle.setLinvel({ x: velocity.x * scale, y: velocity.y * scale }, true);
  }

  setColliderEnabled(id: string, enabled: boolean): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    bodyHandle.collider.setEnabled(enabled);
    if (enabled) {
      bodyHandle.collider.setCollisionGroups(ARTIFACT_COLLISION_GROUPS);
      bodyHandle.handle.wakeUp();
    }
  }

  /** Remove an artifact from the physics simulation (held, shot, on ramp). */
  parkArtifactBody(id: string, pose: Pose): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    this.setBodyPose(id, pose);
    bodyHandle.collider.setCollisionGroups(PARKED_COLLISION_GROUPS);
    bodyHandle.collider.setEnabled(false);
    bodyHandle.handle.sleep();
  }

  /** Restore a field artifact to dynamic simulation. */
  activateArtifactBody(id: string, pose: Pose, vx: number, vy: number): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    this.setBodyPose(id, pose);
    bodyHandle.collider.setCollisionGroups(ARTIFACT_COLLISION_GROUPS);
    bodyHandle.collider.setEnabled(true);
    this.setLinearVelocityInches(id, vx, vy);
    bodyHandle.handle.wakeUp();
  }

  setLinearVelocityInches(id: string, vx: number, vy: number): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle || bodyHandle.handle.isFixed()) return;
    bodyHandle.handle.setLinvel(
      { x: vx * INCHES_TO_METERS, y: vy * INCHES_TO_METERS },
      true,
    );
  }

  syncKinematicRobot(id: string, pose: Pose, vx: number, vy: number): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    const physicsPose = pedroToPhysics(pose);
    bodyHandle.handle.setNextKinematicTranslation({ x: physicsPose.x, y: physicsPose.y });
    bodyHandle.handle.setNextKinematicRotation(physicsPose.heading);
    // Feed drive velocity so Rapier resolves contacts against artifacts (capped to limit launch speed).
    const maxInchesPerSec = 36;
    const speed = Math.hypot(vx, vy);
    const scale = speed > maxInchesPerSec ? maxInchesPerSec / speed : 1;
    bodyHandle.handle.setLinvel(
      { x: vx * scale * INCHES_TO_METERS, y: vy * scale * INCHES_TO_METERS },
      true,
    );
  }

  removeBody(id: string): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle) return;
    this.world.removeCollider(bodyHandle.collider, true);
    this.world.removeRigidBody(bodyHandle.handle);
    this.bodies.delete(id);
  }

  /** Maps artifact friction slider (0.1 = ice … 1.5 = sticky) to 0…1. */
  private static frictionSliderT(friction: number): number {
    return Math.max(0, Math.min(1, (friction - 0.1) / (1.5 - 0.1)));
  }

  /** Updates artifact sliding feel: slider is the primary control (Rapier μ + damping). */
  setArtifactSurfaceFriction(id: string, friction: number): void {
    const bodyHandle = this.bodies.get(id);
    if (!bodyHandle || bodyHandle.handle.isFixed()) return;
    const t = PhysicsWorld.frictionSliderT(friction);
    // Wider collider μ than field.json default so the slider range is obvious.
    bodyHandle.collider.setFriction(0.04 + t * 2.1);
    bodyHandle.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply);
    // Ice ≈ no damping; sticky settles quickly.
    bodyHandle.handle.setLinearDamping(t * t * 0.55);
    bodyHandle.handle.wakeUp();
  }

  setColliderFriction(id: string, friction: number): void {
    this.setArtifactSurfaceFriction(id, friction);
  }

  clampDynamicBodiesWithPrefix(prefix: string, maxInchesPerSec: number): void {
    for (const [id, bodyHandle] of this.bodies) {
      if (!id.startsWith(prefix) || bodyHandle.handle.isFixed()) continue;
      if (!bodyHandle.collider.isEnabled()) continue;
      this.clampLinearSpeed(id, maxInchesPerSec);
    }
  }

  /** Post-step drag tied to slider: low μ = coast, high μ = stop quickly. */
  applySlidingFrictionForPrefix(prefix: string, friction: number, dt: number): void {
    const t = PhysicsWorld.frictionSliderT(friction);
    const decayPerSec = Math.pow(t, 2.2) * 140;
    if (decayPerSec < 0.08) return;
    const factor = Math.max(0, 1 - decayPerSec * dt);
    const minSpeedMps = 0.08 * INCHES_TO_METERS;

    for (const [id, bodyHandle] of this.bodies) {
      if (!id.startsWith(prefix) || bodyHandle.handle.isFixed()) continue;
      if (!bodyHandle.collider.isEnabled()) continue;

      const velocity = bodyHandle.handle.linvel();
      const speedMps = Math.hypot(velocity.x, velocity.y);
      if (speedMps < minSpeedMps) continue;

      bodyHandle.handle.setLinvel(
        { x: velocity.x * factor, y: velocity.y * factor },
        true,
      );
    }
  }

  destroy(): void {
    this.bodies.clear();
    this.pendingForces.clear();
    if (this.initialized) {
      this.world.free();
      this.eventQueue.free();
    }
    this.initialized = false;
  }
}

export { RAPIER };
