import type { FieldDefinition, Pose, StagedArtifactLayout, Vector2 } from '@ftc-sim/field';
import type { Alliance, MatchPhase, MatchState, MatchRobotSnapshot, ObeliskMotifId } from '@ftc-sim/game-decode';
import { DecodeRulesEngine } from '@ftc-sim/game-decode';
import {
  ArtifactSimulation,
  type MechanismCommand,
  type PhysicsAdapter,
  type RobotMechanismTick,
  type SimArtifactState,
} from '@ftc-sim/mechanisms';
import { PhysicsWorld, physicsLog } from '@ftc-sim/physics';
import type { RobotFootprint } from '@ftc-sim/robot';
import type { SessionBarrier } from './barriers.js';
import { PLAYER_ROBOT_ID } from './match-robots.js';
import { barrierToBodyDef, ROBOT_BODY_ID } from './physics-scene.js';

function robotPhysicsBodyId(robotId: string): string {
  return robotId === PLAYER_ROBOT_ID ? ROBOT_BODY_ID : `npc_${robotId}`;
}

export interface NpcRobotSync {
  id: string;
  pose: Pose;
  linear: Vector2;
}

export interface RobotMechanismTickInput {
  robotId: string;
  pose: Pose;
  linear: Vector2;
  alliance: Alliance;
  command?: MechanismCommand;
  shootEdge: boolean;
  gateEdge: boolean;
  shootHeld: boolean;
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
    this.physics.setColliderEnabled(ROBOT_BODY_ID, true);
    this.physics.setRobotArtifactCollision(ROBOT_BODY_ID, true);
    this.pendingNpcSync = npcRobots ?? [];
    this.syncNpcRobots(npcRobots ?? []);
    for (const bodyId of this.npcBodyIds) {
      this.physics.setColliderEnabled(bodyId, true);
      this.physics.setRobotArtifactCollision(bodyId, true);
    }
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

  setShootHold(robotId: string, active: boolean): void {
    if (!this.initialized) return;
    this.sim.setShootHold(robotId, active);
  }

  /** Solo convenience — shoot hold on player slot. */
  setPlayerShootHold(active: boolean): void {
    this.setShootHold(PLAYER_ROBOT_ID, active);
  }

  evaluateEndOfAuto(robots: MatchRobotSnapshot[]): void {
    if (!this.initialized) return;
    this.sim.evaluateEndOfAuto(robots);
  }

  evaluateEndOfMatch(robots: MatchRobotSnapshot[]): void {
    if (!this.initialized) return;
    this.sim.evaluateEndOfMatch(robots);
  }

  tickRobots(
    dt: number,
    robots: RobotMechanismTickInput[],
    footprint: RobotFootprint,
    matchPhase: MatchPhase = 'teleop',
    matchRobots?: MatchRobotSnapshot[],
    teleopTimeRemainingSec?: number,
    npcRobots?: NpcRobotSync[],
  ): void {
    if (!this.initialized) return;
    const scoringPhase = matchPhase === 'auto' ? 'auto' : 'teleop';
    this.pendingNpcSync = npcRobots ?? [];

    for (const robot of robots) {
      const bodyId = robotPhysicsBodyId(robot.robotId);
      this.physics.syncKinematicRobot(bodyId, robot.pose, robot.linear.x, robot.linear.y);
      this.sim.applyCommand(robot.robotId, robot.command, robot.shootEdge, robot.gateEdge);
      this.sim.setShootHold(robot.robotId, robot.shootHeld);
      this.physics.setRobotArtifactCollision(
        bodyId,
        !this.sim.shouldBypassRobotArtifactCollision(
          robot.robotId,
          robot.pose,
          footprint,
          scoringPhase,
        ),
      );
    }

    const simRobots: RobotMechanismTick[] = robots.map((robot) => ({
      robotId: robot.robotId,
      pose: robot.pose,
      linear: robot.linear,
      alliance: robot.alliance,
      command: robot.command,
      shootEdge: robot.shootEdge,
      gateEdge: robot.gateEdge,
      shootHeld: robot.shootHeld,
    }));

    this.sim.tickRobots(
      dt,
      simRobots,
      footprint,
      this.adapter(),
      scoringPhase,
      matchRobots,
      teleopTimeRemainingSec,
    );
  }

  /** Solo / legacy single-robot tick. */
  tick(
    dt: number,
    mechanismRobotId: string,
    mechanismPose: Pose,
    mechanismVelocity: Vector2,
    playerPose: Pose,
    playerVelocity: Vector2,
    footprint: RobotFootprint,
    command: MechanismCommand | undefined,
    shootEdge: boolean,
    gateEdge: boolean,
    robotAlliance: Alliance,
    matchPhase: MatchPhase = 'teleop',
    matchRobots?: MatchRobotSnapshot[],
    teleopTimeRemainingSec?: number,
    npcRobots?: NpcRobotSync[],
  ): void {
    const robots: RobotMechanismTickInput[] = [
      {
        robotId: mechanismRobotId,
        pose: mechanismPose,
        linear: mechanismVelocity,
        alliance: robotAlliance,
        command,
        shootEdge,
        gateEdge,
        shootHeld: false,
      },
    ];
    if (mechanismRobotId !== PLAYER_ROBOT_ID) {
      robots.unshift({
        robotId: PLAYER_ROBOT_ID,
        pose: playerPose,
        linear: playerVelocity,
        alliance: robotAlliance,
        shootEdge: false,
        gateEdge: false,
        shootHeld: false,
      });
    }
    this.tickRobots(
      dt,
      robots,
      footprint,
      matchPhase,
      matchRobots,
      teleopTimeRemainingSec,
      npcRobots,
    );
  }

  getStoredCount(robotId: string = PLAYER_ROBOT_ID): number {
    return this.sim.getStoredCount(robotId);
  }

  getTotalStoredCount(): number {
    return this.sim.getTotalStoredCount();
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

  /** Hide every robot collider until a lobby slot is claimed (multiplayer). */
  setAllRobotSlotsInactive(): void {
    if (!this.initialized) return;
    const park = { x: -64, y: -64, heading: 0 };
    this.physics.syncKinematicRobot(ROBOT_BODY_ID, park, 0, 0);
    this.physics.setColliderEnabled(ROBOT_BODY_ID, false);
    for (const bodyId of this.npcBodyIds) {
      this.physics.syncKinematicRobot(bodyId, park, 0, 0);
      this.physics.setColliderEnabled(bodyId, false);
    }
  }

  setRobotSlotActive(robotId: string, active: boolean, pose: Pose, _footprint: RobotFootprint): void {
    if (!this.initialized) return;
    const bodyId = robotPhysicsBodyId(robotId);
    if (active) {
      this.physics.syncKinematicRobot(bodyId, pose, 0, 0);
      this.physics.setColliderEnabled(bodyId, true);
      this.physics.setRobotArtifactCollision(bodyId, true);
    } else {
      const park = { x: -64, y: -64, heading: 0 };
      this.physics.syncKinematicRobot(bodyId, park, 0, 0);
      this.physics.setColliderEnabled(bodyId, false);
    }
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
