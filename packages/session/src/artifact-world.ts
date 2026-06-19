import type { FieldDefinition, Pose, StagedArtifactLayout, Vector2 } from '@ftc-sim/field';
import type { Alliance, MatchPhase, MatchState, MatchRobotSnapshot, ObeliskMotifId } from '@ftc-sim/game-decode';
import { DecodeRulesEngine } from '@ftc-sim/game-decode';
import {
  ArtifactSimulation,
  type MechanismCommand,
  type PhysicsAdapter,
  type SimArtifactState,
} from '@ftc-sim/mechanisms';
import { PhysicsWorld, physicsLog } from '@ftc-sim/physics';
import type { RobotFootprint } from '@ftc-sim/robot';
import type { SessionBarrier } from './barriers.js';
import { barrierToBodyDef, ROBOT_BODY_ID } from './physics-scene.js';

export interface NpcRobotSync {
  id: string;
  pose: Pose;
  linear: Vector2;
}

export const DEFAULT_ARTIFACT_FRICTION = 0.25;

export class ArtifactWorld {
  private physics = new PhysicsWorld({ timestep: 1 / 120 });
  private rules: DecodeRulesEngine;
  private sim: ArtifactSimulation;
  private initialized = false;
  private artifactBodyIds: string[] = [];
  private npcBodyIds: string[] = [];
  private editableBarrierIds: string[] = [];
  private artifactFriction = DEFAULT_ARTIFACT_FRICTION;
  private pendingNpcSync: NpcRobotSync[] = [];
  private static readonly MAX_ARTIFACT_SPEED_IN_S = 68;

  constructor(
    field: FieldDefinition,
    alliance: Alliance,
  ) {
    this.field = field;
    this.rules = new DecodeRulesEngine({ field, alliance });
    this.sim = new ArtifactSimulation(field, this.rules, alliance);
  }

  private field: FieldDefinition;

  get ready(): boolean {
    return this.initialized;
  }

  async init(
    staging: StagedArtifactLayout[],
    barriers: SessionBarrier[],
    startPose: Pose,
    footprint: RobotFootprint,
    npcRobots?: NpcRobotSync[],
  ): Promise<void> {
    await this.physics.init();
    physicsLog.clear();
    physicsLog.info('Spawning dynamic artifacts…');

    for (const body of this.field.bodies) {
      if (body.id.startsWith('wall_')) {
        this.physics.createBodyFromDef(body.id, body);
      }
    }

    this.editableBarrierIds = [];
    for (const barrier of barriers) {
      this.physics.createBodyFromDef(barrier.id, barrierToBodyDef(barrier));
      this.editableBarrierIds.push(barrier.id);
    }

    this.physics.createKinematicRobotBody(
      ROBOT_BODY_ID,
      startPose,
      footprint.width,
      footprint.length,
      0.8,
    );
    this.physics.setRobotArtifactCollision(ROBOT_BODY_ID, true);

    const piece = this.field.gamePieces?.find((entry) => entry.type === 'artifact');
    const radius = piece?.radius ?? 2.5;
    const mass = piece?.mass ?? 0.0748;
    const material = piece?.material ?? { friction: DEFAULT_ARTIFACT_FRICTION, restitution: 0.02 };

    this.artifactBodyIds = [];
    for (const spawn of staging) {
      const bodyId = `artifact_${spawn.id}`;
      this.artifactBodyIds.push(bodyId);
      this.physics.createDynamicCircle(bodyId, spawn.pose, radius, mass, material);
    }

    this.sim.init(staging);
    this.pendingNpcSync = [];
    this.sim.settle(this.adapter(), 24);

    this.installNpcBodies(footprint, npcRobots ?? []);
    this.pendingNpcSync = npcRobots ?? [];
    this.syncNpcRobots(npcRobots ?? []);
    this.sim.settle(this.adapter(), 8);

    this.initialized = true;
    this.applyArtifactFriction();
  }

  private installNpcBodies(footprint: RobotFootprint, npcRobots: NpcRobotSync[]): void {
    this.npcBodyIds = [];
    for (const npc of npcRobots) {
      const bodyId = `npc_${npc.id}`;
      this.npcBodyIds.push(bodyId);
      this.physics.createKinematicRobotBody(bodyId, npc.pose, footprint.width, footprint.length, 0.8);
      this.physics.setRobotArtifactCollision(bodyId, true);
    }
  }

  syncBarriers(barriers: SessionBarrier[]): void {
    if (!this.initialized) return;
    for (const id of this.editableBarrierIds) {
      this.physics.removeBody(id);
    }
    this.editableBarrierIds = [];
    for (const barrier of barriers) {
      this.physics.createBodyFromDef(barrier.id, barrierToBodyDef(barrier));
      this.editableBarrierIds.push(barrier.id);
    }
  }

  randomizeMotif(): void {
    const ids = ['21', '22', '23'] as const;
    const motif = ids[Math.floor(Math.random() * ids.length)]!;
    this.rules.reset(motif);
  }

  setMotif(motif: ObeliskMotifId): void {
    this.rules.reset(motif);
  }

  getMotif(): ObeliskMotifId {
    return this.rules.getState().obeliskMotif;
  }

  reset(
    staging: StagedArtifactLayout[],
    startPose: Pose,
    npcRobots?: NpcRobotSync[],
    motif?: ObeliskMotifId,
  ): void {
    if (!this.initialized) return;

    // Park every artifact body first so held / ramp / flight states cannot leak into the new layout.
    for (const bodyId of this.artifactBodyIds) {
      this.physics.parkArtifactBody(bodyId, { x: 0, y: 0, heading: 0 });
    }

    this.sim.init(staging);
    if (motif) this.setMotif(motif);
    else this.randomizeMotif();

    const spawnById = new Map(staging.map((spawn) => [spawn.id, spawn]));
    for (const bodyId of this.artifactBodyIds) {
      const artifactId = bodyId.replace(/^artifact_/, '');
      const spawn = spawnById.get(artifactId);
      if (!spawn) continue;
      this.physics.activateArtifactBody(bodyId, spawn.pose, 0, 0);
    }

    this.physics.syncKinematicRobot(ROBOT_BODY_ID, startPose, 0, 0);
    this.physics.setRobotArtifactCollision(ROBOT_BODY_ID, true);
    this.pendingNpcSync = npcRobots ?? [];
    this.syncNpcRobots(npcRobots ?? []);
    this.sim.settle(this.adapter(), 12);
    this.applyArtifactFriction();
  }

  syncNpcRobots(npcRobots: NpcRobotSync[]): void {
    if (!this.initialized) return;
    for (const npc of npcRobots) {
      const bodyId = `npc_${npc.id}`;
      if (!this.npcBodyIds.includes(bodyId)) continue;
      this.physics.syncKinematicRobot(bodyId, npc.pose, npc.linear.x, npc.linear.y);
      this.physics.setRobotArtifactCollision(bodyId, true);
    }
  }

  scheduleBurstShots(count: number, intervalSec: number): void {
    if (!this.initialized) return;
    this.sim.scheduleBurstShots(count, intervalSec);
  }

  setShootHold(active: boolean): void {
    if (!this.initialized) return;
    this.sim.setShootHold(active);
  }

  evaluateEndOfAuto(): void {
    if (!this.initialized) return;
    this.sim.evaluateEndOfAuto();
  }

  evaluateEndOfMatch(robots: MatchRobotSnapshot[]): void {
    if (!this.initialized) return;
    this.sim.evaluateEndOfMatch(robots);
  }

  tick(
    dt: number,
    robotPose: Pose,
    robotVelocity: Vector2,
    footprint: RobotFootprint,
    command: MechanismCommand | undefined,
    shootEdge: boolean,
    gateEdge: boolean,
    matchPhase: MatchPhase = 'teleop',
    matchRobots?: MatchRobotSnapshot[],
    teleopTimeRemainingSec?: number,
    npcRobots?: NpcRobotSync[],
  ): void {
    if (!this.initialized) return;
    this.sim.applyCommand(command, shootEdge, gateEdge);
    const scoringPhase = matchPhase === 'auto' ? 'auto' : 'teleop';
    this.physics.setRobotArtifactCollision(
      ROBOT_BODY_ID,
      !this.sim.shouldBypassRobotArtifactCollision(robotPose, footprint, scoringPhase),
    );
    this.pendingNpcSync = npcRobots ?? [];
    this.sim.tick(
      dt,
      robotPose,
      robotVelocity,
      footprint,
      this.adapter(),
      scoringPhase,
      matchRobots,
      teleopTimeRemainingSec,
    );
  }

  getRenderArtifacts(): SimArtifactState[] {
    return this.sim.getRenderArtifacts();
  }

  getMatchState(): MatchState {
    return this.rules.getState();
  }

  getSnapshot() {
    return this.sim.getSnapshot();
  }

  getDebugLogs() {
    return this.sim.getDebugLogs();
  }

  setArtifactFriction(friction: number): void {
    if (Math.abs(friction - this.artifactFriction) < 1e-6) return;
    this.artifactFriction = friction;
    this.applyArtifactFriction();
  }

  private applyArtifactFriction(): void {
    if (!this.initialized) return;
    for (const bodyId of this.artifactBodyIds) {
      this.physics.setArtifactSurfaceFriction(bodyId, this.artifactFriction);
    }
  }

  destroy(): void {
    this.physics.destroy();
    this.initialized = false;
  }

  private adapter(): PhysicsAdapter {
    const friction = this.artifactFriction;
    return {
      getArtifactPose: (bodyId) => this.physics.getBodyPose(bodyId),
      setArtifactPose: (bodyId, pose) => this.physics.setBodyPose(bodyId, pose),
      setArtifactVelocity: (bodyId, vx, vy) =>
        this.physics.setLinearVelocityInches(bodyId, vx, vy),
      setArtifactEnabled: (bodyId, enabled) => this.physics.setColliderEnabled(bodyId, enabled),
      parkArtifactBody: (bodyId, pose) => this.physics.parkArtifactBody(bodyId, pose),
      activateArtifactBody: (bodyId, pose, vx, vy) =>
        this.physics.activateArtifactBody(bodyId, pose, vx, vy),
      syncRobotCollider: (pose, vx, vy) =>
        this.physics.syncKinematicRobot(ROBOT_BODY_ID, pose, vx, vy),
      step: () => {
        this.syncNpcRobots(this.pendingNpcSync);
        this.physics.step();
        this.physics.applySlidingFrictionForPrefix('artifact_', friction, this.physics.timestep);
        this.physics.clampDynamicBodiesWithPrefix(
          'artifact_',
          ArtifactWorld.MAX_ARTIFACT_SPEED_IN_S,
        );
      },
    };
  }
}
