import type { FieldDefinition, Pose, StagedArtifactLayout, Vector2 } from '@ftc-sim/field';
import type { DecodeRulesEngine, MatchRobotSnapshot } from '@ftc-sim/game-decode';
import type { Alliance, ArtifactColor } from '@ftc-sim/game-decode';
import type { RobotFootprint } from '@ftc-sim/robot';
import { robotCorners } from '@ftc-sim/robot';
import {
  artifactTouchesFrontEdge,
  detectArtifactStuckInStructure,
  findBasinAtPoint,
  gateReleaseVelocity,
  getZoneByType,
  heldArtifactOffset,
  humanPlayerRespawnPose,
  isOutOfFieldBounds,
  localToWorld,
  OVERFLOW_SOUTH_VELOCITY,
  overflowSpawnPose,
  planShot,
  rampSlotPositions,
  rampSouthExitPose,
  robotInGateZone,
  robotInLaunchZone,
  sampleTrajectoryAt,
  type ShotPlan,
  type TrajectorySample,
} from './geometry.js';
import type {
  GateReleaseItem,
  MechanismCommand,
  MechanismSnapshot,
  RobotMechanismTick,
  SimArtifactState,
  StoredArtifact,
} from './types.js';
import { DEFAULT_PLAYER_ROBOT_ID, INTAKE_ACTIVE_THRESHOLD, MAX_STORAGE, SHOOT_HOLD_INTERVAL_S } from './types.js';
import { MechanismLogger } from './mechanism-log.js';

export interface PhysicsAdapter {
  getArtifactPose(bodyId: string): Pose;
  setArtifactPose(bodyId: string, pose: Pose): void;
  setArtifactVelocity(bodyId: string, vx: number, vy: number): void;
  setArtifactEnabled(bodyId: string, enabled: boolean): void;
  parkArtifactBody(bodyId: string, pose: Pose): void;
  activateArtifactBody(bodyId: string, pose: Pose, vx: number, vy: number): void;
  syncRobotCollider(pose: Pose, vx: number, vy: number): void;
  step(): void;
}

interface ActiveFlight {
  artifactId: string;
  color: ArtifactColor;
  bodyId: string;
  trajectory: TrajectorySample[];
  elapsed: number;
  scoringEligible: boolean;
  scored: boolean;
  plan: ShotPlan;
  shooterAlliance: Alliance;
}

interface PendingBodySpawn {
  artifactId: string;
  pose: Pose;
  vx: number;
  vy: number;
}

interface RobotMechanismState {
  stored: StoredArtifact[];
  intakeActive: boolean;
  shootPressed: boolean;
  shootHoldWanted: boolean;
  shootHoldNextShotAt: number;
  pendingShotTimes: number[];
}

function emptyRobotMechanismState(): RobotMechanismState {
  return {
    stored: [],
    intakeActive: false,
    shootPressed: false,
    shootHoldWanted: false,
    shootHoldNextShotAt: 0,
    pendingShotTimes: [],
  };
}

export class ArtifactSimulation {
  private artifacts = new Map<string, SimArtifactState>();
  private robotStates = new Map<string, RobotMechanismState>();
  private rampSlots: { red: (string | null)[]; blue: (string | null)[] } = {
    red: Array(9).fill(null),
    blue: Array(9).fill(null),
  };
  private flights: ActiveFlight[] = [];
  private gateQueue: GateReleaseItem[] = [];
  private gateInside: Record<Alliance, boolean> = { blue: false, red: false };
  private pendingSpawns: PendingBodySpawn[] = [];
  private lastShotEligible = true;
  private simTime = 0;
  private logger = new MechanismLogger();

  constructor(
    private field: FieldDefinition,
    private rules: DecodeRulesEngine,
    private alliance: Alliance,
  ) {}

  init(staging: StagedArtifactLayout[]): void {
    this.artifacts.clear();
    this.robotStates.clear();
    this.resetRobotMechanismStates();
    this.rampSlots = { red: Array(9).fill(null), blue: Array(9).fill(null) };
    this.flights = [];
    this.gateQueue = [];
    this.gateInside = { blue: false, red: false };
    this.pendingSpawns = [];
    this.simTime = 0;
    this.logger.clear();
    this.rules.reset();

    for (const spawn of staging) {
      this.artifacts.set(spawn.id, {
        id: spawn.id,
        color: spawn.color,
        phase: 'onField',
        bodyId: `artifact_${spawn.id}`,
        pose: { ...spawn.pose, heading: 0 },
        opacity: 1,
      });
    }
  }

  /** Clear intake/shoot latch state so artifact collision cannot leak across matches. */
  resetRobotMechanismStates(): void {
    this.robotStates.clear();
    this.robotStates.set(DEFAULT_PLAYER_ROBOT_ID, emptyRobotMechanismState());
  }

  getSnapshot(): MechanismSnapshot {
    const byRobot: Record<string, { stored: StoredArtifact[]; intakeActive: boolean }> = {};
    for (const [robotId, state] of this.robotStates) {
      byRobot[robotId] = {
        stored: [...state.stored],
        intakeActive: state.intakeActive,
      };
    }
    const playerState = this.getRobotState(DEFAULT_PLAYER_ROBOT_ID);
    return {
      stored: [...playerState.stored],
      byRobot,
      artifacts: [...this.artifacts.values()],
      gateReleaseQueue: [...this.gateQueue],
      intakeActive: playerState.intakeActive,
      lastShotEligible: this.lastShotEligible,
      rampOccupancy: this.rules.getState().rampOccupancy,
      debugLogs: this.logger.getEntries(),
    };
  }

  getDebugLogs() {
    return this.logger.getEntries();
  }

  private log(
    category: Parameters<MechanismLogger['log']>[0],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.logger.log(category, message, data, this.simTime);
  }

  getRenderArtifacts(): SimArtifactState[] {
    return [...this.artifacts.values()];
  }

  getStoredCount(robotId: string = DEFAULT_PLAYER_ROBOT_ID): number {
    return this.getRobotState(robotId).stored.length;
  }

  getTotalStoredCount(): number {
    let total = 0;
    for (const state of this.robotStates.values()) {
      total += state.stored.length;
    }
    return total;
  }

  private getRobotState(robotId: string): RobotMechanismState {
    let state = this.robotStates.get(robotId);
    if (!state) {
      state = emptyRobotMechanismState();
      this.robotStates.set(robotId, state);
    }
    return state;
  }

  private allHeldArtifactIds(): Set<string> {
    const ids = new Set<string>();
    for (const state of this.robotStates.values()) {
      for (const held of state.stored) {
        ids.add(held.id);
      }
    }
    return ids;
  }

  applyCommand(
    robotId: string,
    cmd: MechanismCommand | undefined,
    shootEdge: boolean,
    _gateEdge: boolean,
  ): void {
    const state = this.getRobotState(robotId);
    state.intakeActive = (cmd?.intake ?? 0) >= INTAKE_ACTIVE_THRESHOLD;
    if (shootEdge) {
      state.shootPressed = true;
      this.log('cmd', `Shoot edge detected (${robotId})`);
    }
  }

  /** True during AUTO, or while intake is on and storage has room (drive through balls to pick up a line). */
  shouldBypassRobotArtifactCollision(
    robotId: string,
    _robotPose: Pose,
    _footprint: RobotFootprint,
    scoringPhase: 'auto' | 'teleop' = 'teleop',
  ): boolean {
    if (scoringPhase === 'auto') return true;
    const state = this.getRobotState(robotId);
    return state.intakeActive && state.stored.length < MAX_STORAGE;
  }

  /** Queue timed shot attempts (e.g. AUTO burst: 3 shots 0.1s apart). */
  scheduleBurstShots(count: number, intervalSec: number, robotId: string = DEFAULT_PLAYER_ROBOT_ID): void {
    if (count <= 0 || intervalSec <= 0) return;
    const state = this.getRobotState(robotId);
    let start = this.simTime;
    if (state.pendingShotTimes.length > 0) {
      start = state.pendingShotTimes[state.pendingShotTimes.length - 1]! + intervalSec;
    }
    for (let i = 0; i < count; i++) {
      state.pendingShotTimes.push(start + i * intervalSec);
    }
    this.log('cmd', `Burst scheduled: ${count} shots every ${intervalSec}s`, { start, robotId });
  }

  /** While held, fire one shot every {@link SHOOT_HOLD_INTERVAL_S}. */
  setShootHold(robotId: string, active: boolean): void {
    const state = this.getRobotState(robotId);
    if (active && !state.shootHoldWanted) {
      state.shootHoldNextShotAt = this.simTime;
    }
    if (!active) {
      state.shootHoldNextShotAt = 0;
    }
    state.shootHoldWanted = active;
  }

  evaluateEndOfAuto(robots: MatchRobotSnapshot[]): number {
    this.rules.evaluateAutoLeave(robots);
    return this.rules.evaluatePattern('auto');
  }

  evaluateEndOfMatch(robots: MatchRobotSnapshot[]): number {
    const matches = this.rules.evaluatePattern('teleop');
    this.rules.evaluateMatchParking(robots);
    return matches;
  }

  tick(
    dt: number,
    robotPose: Pose,
    robotVelocity: Vector2,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
    robotAlliance: Alliance,
    matchPhase: 'auto' | 'teleop' = 'teleop',
    matchRobots?: MatchRobotSnapshot[],
    teleopTimeRemainingSec?: number,
  ): void {
    this.tickRobots(
      dt,
      [
        {
          robotId: DEFAULT_PLAYER_ROBOT_ID,
          pose: robotPose,
          linear: robotVelocity,
          alliance: robotAlliance,
          shootEdge: false,
          gateEdge: false,
          shootHeld: false,
        },
      ],
      footprint,
      physics,
      matchPhase,
      matchRobots,
      teleopTimeRemainingSec,
    );
  }

  tickRobots(
    dt: number,
    robots: RobotMechanismTick[],
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
    matchPhase: 'auto' | 'teleop' = 'teleop',
    matchRobots?: MatchRobotSnapshot[],
    teleopTimeRemainingSec?: number,
  ): void {
    this.simTime += dt;
    const rulesPhase = matchPhase === 'auto' ? 'auto' : 'teleop';
    this.rules.syncPhase(rulesPhase, this.simTime);

    for (const robot of robots) {
      this.getRobotState(robot.robotId);
      const state = this.getRobotState(robot.robotId);
      if (state.intakeActive) {
        this.tryIntake(robot.robotId, robot.pose, footprint, physics);
      }
      if (state.shootPressed) {
        state.shootPressed = false;
        this.tryShoot(robot.robotId, robot.pose, robot.linear, footprint, physics, robot.alliance);
      }
      this.processScheduledShots(robot.robotId, robot.pose, robot.linear, footprint, physics, robot.alliance);
      this.maintainShootHold(robot.robotId, robot.pose, robot.linear, footprint, physics, robot.alliance);
    }

    for (const robot of robots) {
      const state = this.getRobotState(robot.robotId);
      if (state.stored.length > 0) {
        this.updateHeld(robot.robotId, robot.pose, footprint, physics);
      }
    }

    this.checkAutoGates(robots, footprint);
    if (matchRobots && teleopTimeRemainingSec !== undefined) {
      this.rules.tickContactRules(matchRobots, teleopTimeRemainingSec);
    }
    this.updateFlights(dt, physics);
    this.applyPendingSpawns(physics);
    this.updateGateQueue(physics);
    physics.step();
    this.syncOnFieldFromPhysics(physics);
    this.recoverStuckArtifacts(physics);
  }

  settle(physics: PhysicsAdapter, steps = 12): void {
    for (let i = 0; i < steps; i++) {
      physics.step();
    }
    this.syncOnFieldFromPhysics(physics);
  }

  private syncOnFieldFromPhysics(physics: PhysicsAdapter): void {
    for (const artifact of this.artifacts.values()) {
      if (artifact.phase === 'onField' || artifact.phase === 'overflow') {
        artifact.pose = physics.getArtifactPose(artifact.bodyId);
        artifact.opacity = 1;
      }
    }
  }

  /** Teleport artifacts that clip through goal/ramp barriers back to human player. */
  private recoverStuckArtifacts(physics: PhysicsAdapter): void {
    for (const artifact of this.artifacts.values()) {
      if (artifact.phase !== 'onField') continue;
      const center = { x: artifact.pose.x, y: artifact.pose.y };
      const stuck = detectArtifactStuckInStructure(this.field, center);
      if (!stuck) continue;
      this.log('physics', `Stuck in ${stuck.kind} — respawn human player`, {
        id: artifact.id,
        alliance: stuck.alliance,
        pos: center,
      });
      physics.setArtifactVelocity(artifact.bodyId, 0, 0);
      this.respawnToHumanPlayer(artifact.id, stuck.alliance);
    }
  }

  private queueBodySpawn(artifactId: string, pose: Pose, vx: number, vy: number): void {
    this.pendingSpawns.push({ artifactId, pose, vx, vy });
  }

  private applyPendingSpawns(physics: PhysicsAdapter): void {
    for (const spawn of this.pendingSpawns) {
      const artifact = this.artifacts.get(spawn.artifactId);
      if (!artifact) continue;
      physics.activateArtifactBody(artifact.bodyId, spawn.pose, spawn.vx, spawn.vy);
    }
    this.pendingSpawns = [];
  }

  private tryIntake(
    robotId: string,
    robotPose: Pose,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
  ): void {
    const state = this.getRobotState(robotId);
    if (state.stored.length >= MAX_STORAGE) return;

    const heldIds = this.allHeldArtifactIds();

    for (const artifact of this.artifacts.values()) {
      if (artifact.phase !== 'onField' && artifact.phase !== 'overflow') continue;
      if (heldIds.has(artifact.id)) continue;

      const center = { x: artifact.pose.x, y: artifact.pose.y };
      if (!artifactTouchesFrontEdge(center, robotPose, footprint)) continue;

      const slot = state.stored.length as 0 | 1 | 2;
      state.stored.push({ id: artifact.id, color: artifact.color, slot });
      artifact.phase = 'held';
      artifact.opacity = 1;
      const local = heldArtifactOffset(slot, footprint);
      const world = localToWorld(local, robotPose);
      artifact.pose = { x: world.x, y: world.y, heading: 0 };
      physics.parkArtifactBody(artifact.bodyId, artifact.pose);
      this.log('intake', `Intake ${artifact.id} (${artifact.color}) → slot ${slot}`, {
        robotId,
        robot: { x: robotPose.x, y: robotPose.y },
        artifact: center,
        stored: state.stored.length,
      });
      return;
    }
  }

  private updateHeld(
    robotId: string,
    robotPose: Pose,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
  ): void {
    const state = this.getRobotState(robotId);
    for (const held of state.stored) {
      const artifact = this.artifacts.get(held.id);
      if (!artifact) continue;
      const local = heldArtifactOffset(held.slot, footprint);
      const world = localToWorld(local, robotPose);
      artifact.pose = { x: world.x, y: world.y, heading: 0 };
      physics.parkArtifactBody(artifact.bodyId, artifact.pose);
    }
  }

  private processScheduledShots(
    robotId: string,
    robotPose: Pose,
    robotVelocity: Vector2,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
    robotAlliance: Alliance,
  ): void {
    const state = this.getRobotState(robotId);
    if (state.pendingShotTimes.length === 0) return;
    if (state.pendingShotTimes[0]! > this.simTime) return;
    state.pendingShotTimes.shift();
    this.tryShoot(robotId, robotPose, robotVelocity, footprint, physics, robotAlliance);
  }

  private maintainShootHold(
    robotId: string,
    robotPose: Pose,
    robotVelocity: Vector2,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
    robotAlliance: Alliance,
  ): void {
    const state = this.getRobotState(robotId);
    if (!state.shootHoldWanted) return;
    if (this.simTime < state.shootHoldNextShotAt) return;
    state.shootHoldNextShotAt = this.simTime + SHOOT_HOLD_INTERVAL_S;
    this.tryShoot(robotId, robotPose, robotVelocity, footprint, physics, robotAlliance);
  }

  private tryShoot(
    robotId: string,
    robotPose: Pose,
    robotVelocity: Vector2,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
    robotAlliance: Alliance,
  ): void {
    const state = this.getRobotState(robotId);
    if (state.stored.length === 0) return;

    const held = state.stored.shift();
    if (!held) return;

    const artifact = this.artifacts.get(held.id);
    if (!artifact) return;

    const eligible = robotInLaunchZone(robotPose, footprint, this.field);
    this.lastShotEligible = eligible;

    const plan = planShot(robotPose, robotVelocity, footprint, this.field, robotAlliance);
    physics.parkArtifactBody(artifact.bodyId, { ...plan.launchPoint, heading: 0 });

    artifact.phase = 'inFlight';
    artifact.opacity = 0.45;
    artifact.scored = false;
    artifact.flightElapsed = 0;
    artifact.pose = { ...plan.launchPoint, heading: 0 };

    this.flights.push({
      artifactId: held.id,
      color: held.color,
      bodyId: artifact.bodyId,
      trajectory: plan.trajectory,
      elapsed: 0,
      scoringEligible: eligible,
      scored: false,
      plan,
      shooterAlliance: robotAlliance,
    });

    this.log('shoot', `Shot ${held.id} eligible=${eligible}`, {
      robotId,
      launch: plan.launchPoint,
      speed: plan.shotSpeed,
      distanceToGoal: plan.distanceToGoal,
      headingDeg: ((robotPose.heading * 180) / Math.PI).toFixed(1),
      robot: { x: robotPose.x, y: robotPose.y },
    });

    if (!eligible) {
      this.rules.getState().events.push({
        t: this.simTime,
        type: 'shot',
        message: 'Shot ignored (outside launch zone)',
      });
    }
  }

  private updateFlights(dt: number, physics: PhysicsAdapter): void {
    if (this.flights.length === 0) return;
    const active: ActiveFlight[] = [];
    for (const flight of this.flights) {
      if (this.advanceFlight(flight, dt, physics)) {
        active.push(flight);
      }
    }
    this.flights = active;
  }

  /** Returns true when the flight is still in progress. */
  private advanceFlight(flight: ActiveFlight, dt: number, physics: PhysicsAdapter): boolean {
    flight.elapsed += dt;
    const artifact = this.artifacts.get(flight.artifactId);
    if (!artifact) return false;

    const pos = sampleTrajectoryAt(flight.trajectory, flight.elapsed);
    artifact.pose = { x: pos.x, y: pos.y, heading: 0 };
    artifact.flightElapsed = flight.elapsed;
    physics.parkArtifactBody(flight.bodyId, artifact.pose);

    if (isOutOfFieldBounds(pos, 1)) {
      this.log('flight', `OOB respawn ${flight.artifactId}`, { pos });
      this.respawnToHumanPlayer(flight.artifactId, flight.shooterAlliance);
      return false;
    }

    const basinHit = findBasinAtPoint(pos, this.field);
    if (basinHit && !flight.scored) {
      flight.scored = true;
      artifact.scored = true;
      if (flight.scoringEligible) {
        this.log('flight', `Basin hit ${basinHit.alliance}`, { pos, artifactId: flight.artifactId });
        this.scoreInBasin(flight.artifactId, flight.color, basinHit.alliance, physics);
      } else {
        this.log('flight', 'Ineligible basin hit → human player respawn', { pos });
        this.respawnToHumanPlayer(flight.artifactId, flight.shooterAlliance);
      }
      return false;
    }

    const last = flight.trajectory[flight.trajectory.length - 1];
    if (last && flight.elapsed >= last.t) {
      if (isOutOfFieldBounds(artifact.pose, 1)) {
        this.respawnToHumanPlayer(flight.artifactId, flight.shooterAlliance);
      } else {
        this.landArtifact(flight.artifactId, artifact.pose);
      }
      return false;
    }

    return true;
  }

  private scoreInBasin(
    artifactId: string,
    color: ArtifactColor,
    basinAlliance: Alliance,
    physics: PhysicsAdapter,
  ): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;

    const slotIndex = this.rampSlots[basinAlliance].findIndex((id) => id === null);
    if (slotIndex >= 0) {
      this.rampSlots[basinAlliance][slotIndex] = artifactId;
      const slotPos = rampSlotPositions(basinAlliance)[slotIndex]!;
      artifact.phase = 'onRamp';
      artifact.pose = { ...slotPos, heading: 0 };
      artifact.opacity = 1;
      physics.parkArtifactBody(artifact.bodyId, artifact.pose);
      this.rules.classifyArtifact(basinAlliance, color, true);
      this.log('ramp', `Classified → ramp slot ${slotIndex}`, {
        alliance: basinAlliance,
        slot: slotPos,
        occupied: this.rampSlots[basinAlliance].filter(Boolean).length,
      });
      return;
    }

    this.rules.classifyArtifact(basinAlliance, color, false);
    artifact.phase = 'overflow';
    artifact.opacity = 1;
    const overflowPose = overflowSpawnPose(basinAlliance);
    artifact.pose = { ...overflowPose };
    this.queueBodySpawn(artifactId, overflowPose, 0, -OVERFLOW_SOUTH_VELOCITY);
    this.log('ramp', 'Overflow eject (ramp full)', {
      alliance: basinAlliance,
      spawn: overflowPose,
      velocity: { x: 0, y: -OVERFLOW_SOUTH_VELOCITY },
    });
  }

  private respawnToHumanPlayer(artifactId: string, alliance: Alliance): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;
    const slot = Number.parseInt(artifactId.replace('artifact_', ''), 10) % 3;
    const pose = humanPlayerRespawnPose(alliance, slot);
    artifact.phase = 'onField';
    artifact.opacity = 1;
    artifact.pose = { ...pose };
    this.queueBodySpawn(artifactId, pose, 0, 0);
    this.rules.getState().events.push({
      t: this.simTime,
      type: 'respawn',
      message: `Artifact respawned at ${alliance} human player`,
    });
  }

  private landArtifact(artifactId: string, pose: Pose): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;
    artifact.phase = 'onField';
    artifact.opacity = 1;
    artifact.pose = { ...pose };
    this.queueBodySpawn(artifactId, pose, 0, 0);
  }

  private checkAutoGates(robots: RobotMechanismTick[], footprint: RobotFootprint): void {
    for (const targetAlliance of ['blue', 'red'] as const) {
      const gateZone = getZoneByType(this.field, 'gate_zone', targetAlliance);
      if (!gateZone) continue;

      let anyInside = false;
      let openerAlliance: Alliance | null = null;
      for (const robot of robots) {
        if (!robotInGateZone(robot.pose, footprint, gateZone.polygon)) continue;
        anyInside = true;
        openerAlliance = robot.alliance;
      }

      const wasInside = this.gateInside[targetAlliance];
      this.gateInside[targetAlliance] = anyInside;

      if (!anyInside || wasInside || !openerAlliance) continue;

      this.log('gate', `Gate proximity enter ${targetAlliance}`, {
        zone: gateZone.id,
        openedBy: openerAlliance,
      });
      this.triggerGateRelease(targetAlliance, openerAlliance);
    }
  }

  private triggerGateRelease(targetAlliance: Alliance, openedByAlliance: Alliance): void {
    const slots = this.rampSlots[targetAlliance];
    const occupiedCount = slots.filter((id) => id !== null).length;
    const queueForAlliance = this.gateQueue.filter((q) => q.targetAlliance === targetAlliance).length;

    this.log('gate', `Gate release attempt (${targetAlliance})`, {
      occupiedCount,
      queueForAlliance,
      rampSlotIds: slots,
    });

    if (occupiedCount === 0) {
      this.log('gate', `Gate skipped — ${targetAlliance} ramp empty`);
      return;
    }

    if (queueForAlliance > 0) {
      this.log('gate', `Gate skipped — ${targetAlliance} release in progress`);
      return;
    }

    this.rules.setGateOpen(targetAlliance, true);
    const isOpponentGate = openedByAlliance !== targetAlliance;
    if (isOpponentGate) {
      this.rules.recordOpponentGateOpened(openedByAlliance, targetAlliance);
    }

    const spawnPose = rampSouthExitPose(targetAlliance);
    const velocity = gateReleaseVelocity();
    let delayIndex = 0;

    for (let i = 0; i < slots.length; i++) {
      const artifactId = slots[i];
      if (!artifactId) continue;
      const artifact = this.artifacts.get(artifactId);
      if (!artifact) continue;

      this.gateQueue.push({
        artifactId,
        color: artifact.color,
        targetAlliance,
        openedByAlliance,
        slotIndex: i,
        releaseAt: this.simTime + delayIndex * 0.15,
        velocity,
        spawnPose,
      });
      this.log('gate', `Queued ${artifactId} from slot ${i}`, {
        spawnPose,
        velocity,
        delay: delayIndex * 0.15,
      });
      delayIndex++;
    }

    this.log('gate', `Gate opened ${targetAlliance} — ${delayIndex} balls queued`);
  }

  private updateGateQueue(physics: PhysicsAdapter): void {
    if (this.gateQueue.length === 0) return;

    const ready = this.gateQueue.filter((item) => this.simTime >= item.releaseAt);
    this.gateQueue = this.gateQueue.filter((item) => this.simTime < item.releaseAt);

    for (const item of ready) {
      const artifact = this.artifacts.get(item.artifactId);
      if (!artifact) continue;

      this.rampSlots[item.targetAlliance][item.slotIndex] = null;
      this.rules.removeFromRamp(item.targetAlliance, item.slotIndex);

      if (item.openedByAlliance !== item.targetAlliance) {
        this.rules.recordOpponentRampArtifactReleased(
          item.openedByAlliance,
          item.targetAlliance,
          item.artifactId,
        );
      }

      artifact.phase = 'onField';
      artifact.opacity = 1;
      artifact.pose = { ...item.spawnPose };
      physics.activateArtifactBody(
        artifact.bodyId,
        item.spawnPose,
        item.velocity.x,
        item.velocity.y,
      );
      this.log('gate', `Released ${item.artifactId} from ${item.targetAlliance} ramp`, {
        spawn: item.spawnPose,
        velocity: item.velocity,
      });
    }

    const alliancesReleased = new Set(ready.map((r) => r.targetAlliance));
    for (const alliance of alliancesReleased) {
      if (!this.gateQueue.some((q) => q.targetAlliance === alliance)) {
        this.rules.setGateOpen(alliance, false);
      }
    }
  }
}
