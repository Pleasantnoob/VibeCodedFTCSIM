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
  GATE_RELEASE_INTERVAL_S,
  GATE_RELEASE_SOUTH_VELOCITY,
  getZoneByType,
  heldArtifactOffset,
  humanPlayerRespawnPose,
  humanPlayerAllDepotPositions,
  humanPlayerReservePositions,
  humanPlayerStationPositions,
  isOutOfFieldBounds,
  localToWorld,
  OVERFLOW_SOUTH_VELOCITY,
  overflowSpawnPose,
  planShot,
  rampSlotPositions,
  rampSouthExitPose,
  RAMP_ROLL_MIN_S,
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
  RampRollAnimation,
  RobotMechanismTick,
  SimArtifactState,
  StoredArtifact,
  ArtifactSimPhase,
} from './types.js';
import { DEFAULT_PLAYER_ROBOT_ID, INTAKE_ACTIVE_THRESHOLD, MAX_STORAGE, SHOOT_HOLD_INTERVAL_S } from './types.js';
import { MechanismLogger } from './mechanism-log.js';

/** Off-field park pose for reserve balls before teleop. */
const HIDDEN_ARTIFACT_POSE: Pose = { x: -96, y: -96, heading: 0 };

export type ArtifactMatchPhase = 'setup' | 'init' | 'auto' | 'transition' | 'teleop' | 'post';

export interface PhysicsAdapter {
  getArtifactPose(bodyId: string): Pose;
  setArtifactPose(bodyId: string, pose: Pose): void;
  setArtifactVelocity(bodyId: string, vx: number, vy: number): void;
  setArtifactEnabled(bodyId: string, enabled: boolean): void;
  isArtifactColliderEnabled(bodyId: string): boolean;
  /** True when collider matches expected groups for the sim phase. */
  isArtifactColliderActive(bodyId: string, phase: ArtifactSimPhase): boolean;
  ensureArtifactColliderForPhase(
    bodyId: string,
    phase: ArtifactSimPhase,
    pose: Pose,
    vx?: number,
    vy?: number,
  ): void;
  getArtifactVelocity(bodyId: string): Vector2;
  parkArtifactBody(bodyId: string, pose: Pose): void;
  activateArtifactBody(bodyId: string, pose: Pose, vx: number, vy: number): void;
  activateStationArtifactBody(bodyId: string, pose: Pose, vx: number, vy: number): void;
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
  private rampRolls: RampRollAnimation[] = [];
  private gateInside: Record<Alliance, boolean> = { blue: false, red: false };
  private pendingSpawns: PendingBodySpawn[] = [];
  private lastShotEligible = true;
  private simTime = 0;
  private logger = new MechanismLogger();
  private reserveVisible = false;
  private stationSimActive = false;
  private intakeEdgeEpsilon = 0.35;
  private shootHoldIntervalSec = SHOOT_HOLD_INTERVAL_S;
  private stuckRecoveryCooldownUntil = new Map<string, number>();

  constructor(
    private field: FieldDefinition,
    private rules: DecodeRulesEngine,
    private alliance: Alliance,
  ) {}

  setIntakeEdgeEpsilon(epsilon: number): void {
    this.intakeEdgeEpsilon = epsilon;
  }

  init(staging: StagedArtifactLayout[]): void {
    this.artifacts.clear();
    this.robotStates.clear();
    this.resetRobotMechanismStates();
    this.rampSlots = { red: Array(9).fill(null), blue: Array(9).fill(null) };
    this.flights = [];
    this.gateQueue = [];
    this.rampRolls = [];
    this.gateInside = { blue: false, red: false };
    this.pendingSpawns = [];
    this.simTime = 0;
    this.reserveVisible = false;
    this.stationSimActive = false;
    this.logger.clear();
    this.rules.reset();

    for (const spawn of staging) {
      let phase: SimArtifactState['phase'] = 'onField';
      if (spawn.source.endsWith('_human_player_station')) {
        phase = 'humanPlayerStation';
      } else if (spawn.source.endsWith('_human_player_reserve')) {
        phase = 'humanPlayerReserve';
      }
      this.artifacts.set(spawn.id, {
        id: spawn.id,
        color: spawn.color,
        phase,
        bodyId: `artifact_${spawn.id}`,
        pose: { ...spawn.pose, heading: 0 },
        opacity: phase === 'humanPlayerReserve' ? 0 : 1,
        source: spawn.source,
      });
    }
  }

  /** Reserve balls (outside the field) stay hidden until teleop. */
  syncHumanPlayerReserve(matchPhase: ArtifactMatchPhase, physics: PhysicsAdapter): void {
    const visible = matchPhase === 'teleop' || matchPhase === 'post';
    if (visible === this.reserveVisible) return;
    this.reserveVisible = visible;

    const heldIds = new Set<string>();
    for (const robotState of this.robotStates.values()) {
      for (const held of robotState.stored) {
        heldIds.add(held.id);
      }
    }

    for (const artifact of this.artifacts.values()) {
      if (artifact.phase !== 'humanPlayerReserve') continue;
      if (heldIds.has(artifact.id)) continue;
      if (visible) {
        artifact.opacity = 1;
        physics.activateArtifactBody(artifact.bodyId, artifact.pose, 0, 0);
      } else {
        artifact.opacity = 0;
        physics.parkArtifactBody(artifact.bodyId, HIDDEN_ARTIFACT_POSE);
        physics.setArtifactEnabled(artifact.bodyId, false);
      }
    }
  }

  /** Loading-zone station balls: dynamic from INIT through teleop, parked in setup. */
  syncHumanPlayerStation(matchPhase: ArtifactMatchPhase, physics: PhysicsAdapter): void {
    const active =
      matchPhase === 'init' ||
      matchPhase === 'auto' ||
      matchPhase === 'transition' ||
      matchPhase === 'teleop' ||
      matchPhase === 'post';
    if (active === this.stationSimActive) return;
    this.stationSimActive = active;

    for (const artifact of this.artifacts.values()) {
      if (artifact.phase !== 'humanPlayerStation') continue;
      if (active) {
        physics.activateStationArtifactBody(artifact.bodyId, artifact.pose, 0, 0);
      } else {
        physics.parkArtifactBody(artifact.bodyId, artifact.pose);
      }
    }
  }

  /** Clear intake/shoot latch state so artifact collision cannot leak across matches. */
  resetRobotMechanismStates(): void {
    this.robotStates.clear();
    this.robotStates.set(DEFAULT_PLAYER_ROBOT_ID, emptyRobotMechanismState());
  }

  /** Preload 2 purple + 1 green from the alliance reserve (outside field), not loading-zone station. */
  applyPlayerPreload(
    robotId: string,
    robotAlliance: Alliance,
    robotPose: Pose,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
    rng: () => number = Math.random,
  ): void {
    const state = this.getRobotState(robotId);
    if (state.stored.length >= 3) return;

    const colors: ArtifactColor[] = ['purple', 'purple', 'green'];
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [colors[i], colors[j]] = [colors[j]!, colors[i]!];
    }

    state.stored = [];
    const used = new Set<string>();
    const humanSource = `${robotAlliance}_human_player_reserve`;

    for (let slot = 0; slot < colors.length; slot++) {
      const color = colors[slot]!;
      const artifact = [...this.artifacts.values()].find(
        (entry) =>
          !used.has(entry.id) &&
          entry.source === humanSource &&
          entry.phase === 'humanPlayerReserve' &&
          entry.color === color,
      );
      if (!artifact) continue;

      used.add(artifact.id);
      state.stored.push({
        id: artifact.id,
        color: artifact.color,
        slot: slot as 0 | 1 | 2,
      });
      artifact.phase = 'held';
      artifact.opacity = 1;
      const local = heldArtifactOffset(slot as 0 | 1 | 2, footprint);
      const world = localToWorld(local, robotPose);
      artifact.pose = { x: world.x, y: world.y, heading: 0 };
      physics.parkArtifactBody(artifact.bodyId, artifact.pose);
      physics.setArtifactEnabled(artifact.bodyId, false);
    }

    this.log('intake', `Preloaded ${state.stored.length} from ${humanSource} onto ${robotId}`, {
      robotId,
      alliance: robotAlliance,
      order: state.stored.map((entry) => entry.color),
    });
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

  /** True while any alliance has gate queue items or active ramp rolls. */
  isGateReleaseInProgress(): boolean {
    return this.gateQueue.length > 0 || this.rampRolls.length > 0;
  }

  private log(
    category: Parameters<MechanismLogger['log']>[0],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.logger.log(category, message, data, this.simTime);
  }

  getRenderArtifacts(): SimArtifactState[] {
    return [...this.artifacts.values()].filter((artifact) => artifact.opacity > 0);
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

  /** True while intake is on and storage has room (drive through balls to pick up a line). */
  shouldBypassRobotArtifactCollision(
    robotId: string,
    _robotPose: Pose,
    _footprint: RobotFootprint,
    _scoringPhase: 'auto' | 'teleop' = 'teleop',
  ): boolean {
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

  setShootHoldIntervalSec(intervalSec: number): void {
    if (Number.isFinite(intervalSec) && intervalSec > 0.02) {
      this.shootHoldIntervalSec = intervalSec;
    }
  }

  getShootHoldIntervalSec(): number {
    return this.shootHoldIntervalSec;
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
    this.syncRampOccupancyForPatternScoring();
    this.rules.evaluateAutoLeave(robots);
    return this.rules.evaluatePattern('auto');
  }

  evaluateEndOfMatch(robots: MatchRobotSnapshot[]): number {
    this.syncRampOccupancyForPatternScoring();
    const matches = this.rules.evaluatePattern('teleop');
    this.rules.evaluateMatchParking(robots);
    return matches;
  }

  /**
   * G10.5.2 — PATTERN only counts artifacts directly on the ramp at assessment time.
   * Rules ledger can retain colors after gate rolls; sim slot occupancy is authoritative.
   */
  private syncRampOccupancyForPatternScoring(): void {
    for (const alliance of ['red', 'blue'] as const) {
      const occupancy: (ArtifactColor | null)[] = Array(9).fill(null);
      for (let slotIndex = 0; slotIndex < 9; slotIndex++) {
        const artifactId = this.rampSlots[alliance][slotIndex];
        if (!artifactId) continue;
        const artifact = this.artifacts.get(artifactId);
        if (!artifact || artifact.phase !== 'onRamp') continue;
        occupancy[slotIndex] = artifact.color;
      }
      this.rules.setRampOccupancy(alliance, occupancy);
    }
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
    matchPhase: ArtifactMatchPhase = 'teleop',
    matchRobots?: MatchRobotSnapshot[],
    teleopTimeRemainingSec?: number,
  ): void {
    this.syncHumanPlayerStation(matchPhase, physics);
    this.syncHumanPlayerReserve(matchPhase, physics);
    this.simTime += dt;
    const rulesPhase = matchPhase === 'auto' || matchPhase === 'transition' ? 'auto' : 'teleop';
    this.rules.syncPhase(rulesPhase, this.simTime);
    const mechanismsEnabled =
      matchPhase === 'auto' || matchPhase === 'transition' || matchPhase === 'teleop';

    for (const robot of robots) {
      this.getRobotState(robot.robotId);
      const state = this.getRobotState(robot.robotId);
      if (!mechanismsEnabled) {
        state.intakeActive = false;
        state.shootPressed = false;
        state.shootHoldWanted = false;
        continue;
      }
      if (state.intakeActive) {
        this.tryIntake(robot.robotId, robot.pose, footprint, physics, rulesPhase);
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
      if (
        matchPhase === 'teleop' &&
        teleopTimeRemainingSec <= this.rules.getRules().endgameSec
      ) {
        this.rules.trackMatchParkingProgress(matchRobots);
      }
      this.rules.tickContactRules(matchRobots, teleopTimeRemainingSec);
    }
    this.updateFlights(dt, physics);
    this.applyPendingSpawns(physics);
    this.updateGateQueue(physics);
    this.updateRampRolls(physics);
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
    this.reconcileFieldArtifactColliders(physics);
    this.auditArtifactColliders(physics);
    for (const artifact of this.artifacts.values()) {
      if (artifact.phase === 'humanPlayerReserve' && !this.reserveVisible) continue;
      if (artifact.phase === 'humanPlayerStation' && !this.stationSimActive) continue;
      const simulatesInPhysics =
        artifact.phase === 'onField' ||
        artifact.phase === 'overflow' ||
        artifact.phase === 'humanPlayerStation' ||
        artifact.phase === 'humanPlayerReserve';
      if (!simulatesInPhysics) continue;
      if (!physics.isArtifactColliderEnabled(artifact.bodyId)) continue;
      artifact.pose = physics.getArtifactPose(artifact.bodyId);
      artifact.opacity = 1;
    }
  }

  /** Re-enable colliders for field artifacts left disabled or parked after ramp roll / respawn. */
  private reconcileFieldArtifactColliders(physics: PhysicsAdapter): void {
    for (const artifact of this.artifacts.values()) {
      if (artifact.phase === 'onField' || artifact.phase === 'overflow') {
        if (physics.isArtifactColliderActive(artifact.bodyId, artifact.phase)) continue;
        const vx = physics.getArtifactVelocity(artifact.bodyId).x;
        const vy = physics.getArtifactVelocity(artifact.bodyId).y;
        physics.ensureArtifactColliderForPhase(
          artifact.bodyId,
          artifact.phase,
          artifact.pose,
          vx,
          vy,
        );
        this.log('physics', `Restored collider for ${artifact.id}`, { phase: artifact.phase });
        continue;
      }
      if (artifact.phase === 'humanPlayerStation' && this.stationSimActive) {
        if (physics.isArtifactColliderActive(artifact.bodyId, artifact.phase)) continue;
        physics.ensureArtifactColliderForPhase(artifact.bodyId, artifact.phase, artifact.pose, 0, 0);
        this.log('physics', `Restored station collider for ${artifact.id}`);
      }
    }
  }

  /** Post-tick invariant: sim phase and physics collider state must agree. */
  private auditArtifactColliders(physics: PhysicsAdapter): void {
    for (const artifact of this.artifacts.values()) {
      if (artifact.phase === 'onField' || artifact.phase === 'overflow') {
        if (physics.isArtifactColliderActive(artifact.bodyId, artifact.phase)) continue;
        const vx = physics.getArtifactVelocity(artifact.bodyId).x;
        const vy = physics.getArtifactVelocity(artifact.bodyId).y;
        physics.ensureArtifactColliderForPhase(
          artifact.bodyId,
          artifact.phase,
          artifact.pose,
          vx,
          vy,
        );
        this.log('physics', `Audit restored field collider for ${artifact.id}`);
      } else if (artifact.phase === 'humanPlayerStation' && this.stationSimActive) {
        if (physics.isArtifactColliderActive(artifact.bodyId, artifact.phase)) continue;
        physics.ensureArtifactColliderForPhase(artifact.bodyId, artifact.phase, artifact.pose, 0, 0);
        this.log('physics', `Audit restored station collider for ${artifact.id}`);
      }
    }
  }

  /** Teleport artifacts that clip through goal/ramp barriers back to human player. */
  private recoverStuckArtifacts(physics: PhysicsAdapter): void {
    const STUCK_SPEED_THRESHOLD = 4;
    const STUCK_COOLDOWN_S = 0.75;

    for (const artifact of this.artifacts.values()) {
      if (artifact.phase !== 'onField') continue;
      if (this.simTime < (this.stuckRecoveryCooldownUntil.get(artifact.id) ?? 0)) continue;

      const velocity = physics.getArtifactVelocity(artifact.bodyId);
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed > STUCK_SPEED_THRESHOLD) continue;

      const center = { x: artifact.pose.x, y: artifact.pose.y };
      const stuck = detectArtifactStuckInStructure(this.field, center);
      if (!stuck) continue;

      this.stuckRecoveryCooldownUntil.set(artifact.id, this.simTime + STUCK_COOLDOWN_S);
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
      if (artifact.phase === 'humanPlayerReserve' && !this.reserveVisible) {
        physics.parkArtifactBody(artifact.bodyId, HIDDEN_ARTIFACT_POSE);
        physics.setArtifactEnabled(artifact.bodyId, false);
        continue;
      }
      if (artifact.phase === 'humanPlayerStation') {
        physics.activateStationArtifactBody(artifact.bodyId, spawn.pose, spawn.vx, spawn.vy);
        continue;
      }
      physics.activateArtifactBody(artifact.bodyId, spawn.pose, spawn.vx, spawn.vy);
    }
    this.pendingSpawns = [];
  }

  private tryIntake(
    robotId: string,
    robotPose: Pose,
    footprint: RobotFootprint,
    physics: PhysicsAdapter,
    scoringPhase: 'auto' | 'teleop',
  ): void {
    const state = this.getRobotState(robotId);
    if (state.stored.length >= MAX_STORAGE) return;

    const heldIds = this.allHeldArtifactIds();

    for (const artifact of this.artifacts.values()) {
      if (artifact.phase === 'humanPlayerReserve') {
        if (scoringPhase !== 'teleop') continue;
      } else if (artifact.phase === 'humanPlayerStation') {
        // Station balls are intake-eligible during auto and teleop.
      } else if (artifact.phase !== 'onField' && artifact.phase !== 'overflow') {
        continue;
      }
      if (heldIds.has(artifact.id)) continue;

      const center = { x: artifact.pose.x, y: artifact.pose.y };
      if (!artifactTouchesFrontEdge(center, robotPose, footprint, undefined, this.intakeEdgeEpsilon)) continue;

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
    state.shootHoldNextShotAt = this.simTime + this.shootHoldIntervalSec;
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

    const eligible = robotInLaunchZone(robotPose, footprint, this.field, robotAlliance);
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
        this.landArtifact(flight.artifactId, artifact.pose, physics);
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

    if (this.isGateReleaseActive(basinAlliance)) {
      const rampSlot = this.rules.classifyArtifact(basinAlliance, color, true);
      this.enqueueGateReleaseDuringRoll(basinAlliance, artifactId, color, physics, rampSlot);
      return;
    }

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

  private isGateReleaseActive(alliance: Alliance): boolean {
    if (this.rules.getState().gateOpen[alliance]) return true;
    if (this.gateQueue.some((item) => item.targetAlliance === alliance)) return true;
    if (this.rampRolls.some((roll) => roll.targetAlliance === alliance)) return true;
    return false;
  }

  private nextGateReleaseTime(alliance: Alliance): number {
    let latest = this.simTime;
    for (const item of this.gateQueue) {
      if (item.targetAlliance !== alliance) continue;
      latest = Math.max(latest, item.releaseAt);
    }
    for (const roll of this.rampRolls) {
      if (roll.targetAlliance !== alliance) continue;
      latest = Math.max(latest, roll.startTime + roll.duration);
    }
    return latest;
  }

  /** Ramp full while gate is rolling — append to the release queue instead of overflow. */
  private enqueueGateReleaseDuringRoll(
    alliance: Alliance,
    artifactId: string,
    color: ArtifactColor,
    physics: PhysicsAdapter,
    classifiedRampSlot: number,
  ): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;

    const slotIndex =
      classifiedRampSlot >= 0 && this.rampSlots[alliance][classifiedRampSlot] === null
        ? classifiedRampSlot
        : this.findNewlyClassifiedRampSlot(alliance);
    const positions = rampSlotPositions(alliance);
    const startPose =
      slotIndex >= 0
        ? positions[slotIndex]!
        : positions[positions.length - 1] ?? rampSouthExitPose(alliance);
    const releaseAt = this.nextGateReleaseTime(alliance) + GATE_RELEASE_INTERVAL_S;

    if (slotIndex >= 0) {
      this.rampSlots[alliance][slotIndex] = artifactId;
    }

    this.gateQueue.push({
      artifactId,
      color,
      targetAlliance: alliance,
      openedByAlliance: alliance,
      slotIndex,
      classifiedRampSlot,
      releaseAt,
      velocity: gateReleaseVelocity(),
      spawnPose: rampSouthExitPose(alliance),
      startPose: { ...startPose, heading: 0 },
    });

    artifact.phase = 'onRamp';
    artifact.opacity = 1;
    artifact.pose = { ...startPose, heading: 0 };
    physics.parkArtifactBody(artifact.bodyId, artifact.pose);
    this.log('gate', `Queued ${artifactId} behind active ${alliance} release`, {
      releaseAt,
      startPose,
      slotIndex,
    });
  }

  /** Rules ramp has a color but sim slot is empty — new classification during gate release. */
  private findNewlyClassifiedRampSlot(alliance: Alliance): number {
    const colors = this.rules.getState().rampOccupancy[alliance];
    for (let i = 0; i < colors.length; i++) {
      if (colors[i] !== null && this.rampSlots[alliance][i] === null) {
        return i;
      }
    }
    return -1;
  }

  private respawnToHumanPlayer(artifactId: string, alliance: Alliance): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;

    const slots = humanPlayerAllDepotPositions(alliance);
    const occupied = new Set<string>();
    for (const other of this.artifacts.values()) {
      if (other.id === artifactId) continue;
      if (other.phase !== 'humanPlayerStation' && other.phase !== 'humanPlayerReserve') continue;
      if (!other.source?.includes('_human_player_')) continue;
      if (!other.source.startsWith(alliance)) continue;
      for (const slot of slots) {
        if (Math.hypot(other.pose.x - slot.x, other.pose.y - slot.y) < 1.5) {
          occupied.add(`${slot.x},${slot.y}`);
        }
      }
    }

    let pose = slots[0]!;
    for (const slot of slots) {
      if (!occupied.has(`${slot.x},${slot.y}`)) {
        pose = slot;
        break;
      }
    }

    const reserveSlot = humanPlayerReservePositions(alliance).find(
      (slot) => Math.hypot(pose.x - slot.x, pose.y - slot.y) < 1.5,
    );
    artifact.phase = reserveSlot ? 'humanPlayerReserve' : 'humanPlayerStation';
    artifact.source = reserveSlot
      ? `${alliance}_human_player_reserve`
      : `${alliance}_human_player_station`;
    artifact.pose = { ...pose, heading: 0 };
    if (artifact.phase === 'humanPlayerReserve' && !this.reserveVisible) {
      artifact.opacity = 0;
      this.queueBodySpawn(artifactId, HIDDEN_ARTIFACT_POSE, 0, 0);
    } else {
      artifact.opacity = 1;
      this.queueBodySpawn(artifactId, artifact.pose, 0, 0);
    }
    this.rules.getState().events.push({
      t: this.simTime,
      type: 'respawn',
      message: `Artifact respawned at ${alliance} human player`,
    });
  }

  private landArtifact(artifactId: string, pose: Pose, physics: PhysicsAdapter): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return;
    artifact.phase = 'onField';
    artifact.opacity = 1;
    artifact.pose = { ...pose };
    physics.activateArtifactBody(artifact.bodyId, pose, 0, 0);
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
    const slotPositions = rampSlotPositions(targetAlliance);
    let delayIndex = 0;

    for (let i = 0; i < slots.length; i++) {
      const artifactId = slots[i];
      if (!artifactId) continue;
      const artifact = this.artifacts.get(artifactId);
      if (!artifact) continue;

      const slotPose = { ...slotPositions[i]!, heading: 0 };
      artifact.pose = slotPose;

      this.gateQueue.push({
        artifactId,
        color: artifact.color,
        targetAlliance,
        openedByAlliance,
        slotIndex: i,
        classifiedRampSlot: i,
        releaseAt: this.simTime + delayIndex * GATE_RELEASE_INTERVAL_S,
        velocity,
        spawnPose,
        startPose: slotPose,
      });
      this.log('gate', `Queued ${artifactId} from slot ${i}`, {
        spawnPose,
        velocity,
        delay: delayIndex * GATE_RELEASE_INTERVAL_S,
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

      if (item.slotIndex >= 0) {
        this.rampSlots[item.targetAlliance][item.slotIndex] = null;
        this.rules.removeFromRamp(item.targetAlliance, item.slotIndex);
      } else if (item.classifiedRampSlot >= 0) {
        this.rules.removeFromRamp(item.targetAlliance, item.classifiedRampSlot);
      }

      const rollDistance = Math.hypot(
        item.spawnPose.x - item.startPose.x,
        item.spawnPose.y - item.startPose.y,
      );
      const duration = Math.max(RAMP_ROLL_MIN_S, rollDistance / GATE_RELEASE_SOUTH_VELOCITY);

      this.rampRolls.push({
        artifactId: item.artifactId,
        targetAlliance: item.targetAlliance,
        openedByAlliance: item.openedByAlliance,
        slotIndex: item.slotIndex,
        start: { ...item.startPose },
        end: { ...item.spawnPose },
        startTime: this.simTime,
        duration,
        velocity: item.velocity,
      });

      artifact.phase = 'onRamp';
      artifact.opacity = 1;
      this.log('gate', `Rolling ${item.artifactId} down ${item.targetAlliance} ramp`, {
        from: item.startPose,
        to: item.spawnPose,
        duration,
      });
    }

    const alliancesReleased = new Set(ready.map((r) => r.targetAlliance));
    for (const alliance of alliancesReleased) {
      if (
        !this.gateQueue.some((q) => q.targetAlliance === alliance) &&
        !this.rampRolls.some((r) => r.targetAlliance === alliance)
      ) {
        this.rules.setGateOpen(alliance, false);
      }
    }
  }

  private updateRampRolls(physics: PhysicsAdapter): void {
    if (this.rampRolls.length === 0) return;

    const finished: RampRollAnimation[] = [];

    for (const roll of this.rampRolls) {
      const artifact = this.artifacts.get(roll.artifactId);
      if (!artifact) {
        finished.push(roll);
        continue;
      }

      const t = Math.min(1, (this.simTime - roll.startTime) / roll.duration);
      artifact.pose = {
        x: roll.start.x + (roll.end.x - roll.start.x) * t,
        y: roll.start.y + (roll.end.y - roll.start.y) * t,
        heading: 0,
      };
      physics.setArtifactPose(artifact.bodyId, artifact.pose);

      if (t < 1) continue;

      finished.push(roll);

      if (roll.openedByAlliance !== roll.targetAlliance) {
        this.rules.recordOpponentRampArtifactReleased(
          roll.openedByAlliance,
          roll.targetAlliance,
          roll.artifactId,
        );
      }

      artifact.phase = 'onField';
      artifact.opacity = 1;
      artifact.pose = { ...roll.end };
      physics.activateArtifactBody(
        artifact.bodyId,
        roll.end,
        roll.velocity.x,
        roll.velocity.y,
      );
      this.log('gate', `Released ${roll.artifactId} from ${roll.targetAlliance} ramp`, {
        spawn: roll.end,
        velocity: roll.velocity,
      });
    }

    if (finished.length === 0) return;

    const finishedIds = new Set(finished.map((roll) => roll.artifactId));
    this.rampRolls = this.rampRolls.filter((roll) => !finishedIds.has(roll.artifactId));

    const alliancesDone = new Set(finished.map((r) => r.targetAlliance));
    for (const alliance of alliancesDone) {
      if (
        !this.gateQueue.some((q) => q.targetAlliance === alliance) &&
        !this.rampRolls.some((r) => r.targetAlliance === alliance)
      ) {
        this.rules.setGateOpen(alliance, false);
      }
    }
  }
}
