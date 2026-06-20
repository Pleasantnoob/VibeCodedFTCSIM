import type { FieldDefinition, Pose, StagedArtifactLayout } from '@ftc-sim/field';
import type { Alliance, MatchPhase } from '@ftc-sim/game-decode';
import type { HostCommand, HostRoomSettings, InputFrame, StateSnapshot } from '@ftc-sim/net';
import { MatchClock } from '@ftc-sim/match';
import type { MechanismLogEntry, SimArtifactState } from '@ftc-sim/mechanisms';
import {
  AutoSequenceRunner,
  autoSequenceForAlliance,
  pathChainForAlliance,
  parsePathFileText,
  type AutoSequence,
  type PathChain,
} from '@ftc-sim/pedro';
import { stepMultiRobotDrive } from '@ftc-sim/robot';
import { ArtifactWorld, DEFAULT_ARTIFACT_FRICTION, type RobotMechanismTickInput } from './artifact-world.js';
import { barrierPolygons, type SessionBarrier } from './barriers.js';
import { type AutoFollowerLike, type DriveSample, resolveDriveInput } from './drive-resolver.js';
import {
  buildFieldRobotCatalog,
  buildFieldRobotRenderStates,
  createNpcMotionStates,
  matchRobotSnapshots,
  allianceForClaimableSlot,
  PLAYER_ROBOT_ID,
  spawnPoseForClaimableSlot,
  isClaimableRobotId,
  type ClaimableRobotId,
  type FieldRobotCatalogEntry,
  type FieldRobotRenderState,
  type MatchRobotLayout,
  type NpcMotionState,
} from './match-robots.js';
import {
  DEFAULT_SIM_ROBOT_CONFIG,
  netRobotConfigFromSim,
  simRobotConfigFromNet,
  simRobotFootprint,
  simRobotLimits,
  type SimRobotConfig,
} from './robot-config.js';

export const PHYSICS_DT = 1 / 120;

const PARKED_ROBOT_POSE: Pose = { x: -64, y: -64, heading: 0 };

export interface SimSessionConfig {
  field: FieldDefinition;
  alliance: Alliance;
  artifactStaging: StagedArtifactLayout[];
  barriers: SessionBarrier[];
  startPose: Pose;
  robotConfig?: SimRobotConfig;
  practiceRobots?: MatchRobotLayout[];
  playerTeamNumber?: string;
  artifactFriction?: number;
  fixedMotif?: '21' | '22' | '23';
  /** Net multiplayer: robots appear only after a player claims their slot. */
  onlyClaimedRobots?: boolean;
  robotPreload?: boolean;
}

export interface SimSessionState {
  ready: boolean;
  tickIndex: number;
  pose: Pose;
  linear: { x: number; y: number };
  angular: number;
  npcRobots: NpcMotionState[];
  fieldRobots: FieldRobotRenderState[];
  fieldRobotCatalog: FieldRobotCatalogEntry[];
  liveArtifacts: SimArtifactState[];
  matchGameState: ReturnType<ArtifactWorld['getMatchState']> | null;
  mechanismDebugLogs: MechanismLogEntry[];
  matchSnapshot: ReturnType<MatchClock['snapshot']>;
}

export class SimSession {
  readonly clock = new MatchClock();
  private world: ArtifactWorld;
  private config: SimSessionConfig;
  private robotConfig: SimRobotConfig;
  private barriers: SessionBarrier[];
  private barrierPolys: ReturnType<typeof barrierPolygons>;
  private npcMotion: NpcMotionState[] = [];
  private fieldRobots: FieldRobotRenderState[] = [];
  private fieldRobotCatalog: FieldRobotCatalogEntry[] = [];
  private pose: Pose;
  private linear = { x: 0, y: 0 };
  private angular = 0;
  private artifactFriction = DEFAULT_ARTIFACT_FRICTION;
  private ready = false;
  private tickIndex = 0;
  private prevPhase: MatchPhase = 'setup';
  private playerTeamNumber: string;
  private practiceLayouts: MatchRobotLayout[];
  private follower: AutoFollowerLike | null = null;
  private autoFollower = new AutoSequenceRunner();
  private basePathChain: PathChain | null = null;
  private baseAutoSequence: AutoSequence | null = null;
  private injectedInput: import('@ftc-sim/robot').HolonomicInput | null = null;
  private robotInputs = new Map<string, DriveSample>();
  private robotTeamLabels = new Map<string, string>();
  private claimedRobotIds = new Set<string>();
  private lastSnapshotPhase: MatchPhase = 'setup';
  private lastSnapshotScore = { blue: 0, red: 0 };
  private snapshotCounter = 0;
  private robotPreload = false;
  private hostTeamLabel: string | undefined;

  constructor(config: SimSessionConfig) {
    this.config = config;
    this.robotConfig = config.robotConfig ?? DEFAULT_SIM_ROBOT_CONFIG;
    this.robotPreload = config.robotPreload ?? false;
    this.barriers = config.barriers;
    this.barrierPolys = barrierPolygons(config.barriers);
    this.pose = { ...config.startPose };
    this.playerTeamNumber = config.playerTeamNumber ?? '-3';
    this.practiceLayouts = config.practiceRobots ?? [];
    this.artifactFriction = config.artifactFriction ?? DEFAULT_ARTIFACT_FRICTION;
    this.world = new ArtifactWorld(config.field, config.alliance);
    this.autoFollower.updateConstants({ mass: this.robotConfig.mass });
    this.follower = this.autoFollower;
  }

  loadAutoPath(pathText: string): void {
    const parsed = parsePathFileText(pathText);
    this.basePathChain = parsed.chain;
    this.baseAutoSequence = parsed.autoSequence ?? null;
  }

  private alliancePath(): { chain: PathChain | null; sequence: AutoSequence | null } {
    return {
      chain: this.basePathChain
        ? pathChainForAlliance(this.basePathChain, this.config.alliance)
        : null,
      sequence: this.baseAutoSequence
        ? autoSequenceForAlliance(this.baseAutoSequence, this.config.alliance)
        : null,
    };
  }

  startAutoFollower(): void {
    const { chain, sequence } = this.alliancePath();
    this.autoFollower.setPose(this.pose);
    if (sequence && sequence.steps.length > 0) {
      this.autoFollower.start(sequence.steps);
      return;
    }
    if (chain) {
      this.autoFollower.followPath(chain);
    }
  }

  cancelAutoFollower(): void {
    this.autoFollower.cancelPath();
  }

  async init(): Promise<void> {
    this.npcMotion = createNpcMotionStates(this.practiceLayouts);
    this.fieldRobotCatalog = buildFieldRobotCatalog(this.practiceLayouts, {
      alliance: this.config.alliance,
      teamNumber: this.playerTeamNumber,
      width: this.robotConfig.footprintWidth,
      length: this.robotConfig.footprintLength,
    });
    const footprint = simRobotFootprint(this.robotConfig);
    await this.world.init(
      this.config.artifactStaging,
      this.barriers,
      this.pose,
      footprint,
      this.buildNpcSync(),
    );
    if (this.config.fixedMotif) {
      this.world.setMotif(this.config.fixedMotif);
    } else {
      this.world.randomizeMotif();
    }
    this.world.setArtifactFriction(this.artifactFriction);
    this.refreshFieldRobots();
    if (this.config.onlyClaimedRobots) {
      this.world.setAllRobotSlotsInactive();
      this.pose = { ...PARKED_ROBOT_POSE };
      for (const npc of this.npcMotion) {
        npc.pose = { ...PARKED_ROBOT_POSE };
        npc.linear = { x: 0, y: 0 };
        npc.angular = 0;
      }
    }
    this.ready = true;
  }

  destroy(): void {
    this.world.destroy();
    this.ready = false;
  }

  setFollower(follower: AutoFollowerLike | null): void {
    this.follower = follower;
  }

  setInjectedInput(input: import('@ftc-sim/robot').HolonomicInput | null): void {
    this.injectedInput = input;
  }

  setPendingInput(sample: DriveSample): void {
    this.robotInputs.set(PLAYER_ROBOT_ID, sample);
  }

  applyInputFrame(frame: InputFrame): void {
    const sample: DriveSample = {
      input: {
        forward: frame.drive.forward,
        strafe: frame.drive.strafe,
        turn: frame.drive.turn,
        brake: frame.drive.brake,
        endpointBrake: frame.drive.endpointBrake,
      },
      driveFrame: frame.drive.driveFrame === 'field' ? 'field' : 'robot',
      mechanism: {
        command: frame.mechanism,
        shootEdge: frame.shootEdge,
        gateEdge: frame.gateEdge ?? false,
        shootHeld: frame.mechanism.shoot ?? false,
      },
    };
    this.robotInputs.set(frame.robotId, sample);
  }

  /** Clear buffered drive input for every slot (call once per server tick). */
  clearRobotInputs(): void {
    this.robotInputs.clear();
  }

  syncBarriers(barriers: SessionBarrier[]): void {
    this.barriers = barriers;
    this.barrierPolys = barrierPolygons(barriers);
    this.world.syncBarriers(barriers);
  }

  setArtifactFriction(friction: number): void {
    this.artifactFriction = friction;
    this.world.setArtifactFriction(friction);
  }

  /** Override team label shown on field / overlay for a robot slot. */
  setRobotTeamLabel(robotId: string, label: string): void {
    const trimmed = label.trim();
    if (!trimmed) {
      this.robotTeamLabels.delete(robotId);
    } else {
      this.robotTeamLabels.set(robotId, trimmed);
    }
    this.refreshFieldRobots();
  }

  clearRobotTeamLabel(robotId: string): void {
    this.robotTeamLabels.delete(robotId);
    this.refreshFieldRobots();
  }

  applyHostRoomSettings(settings: HostRoomSettings): void {
    this.robotConfig = simRobotConfigFromNet(settings.robot);
    this.config = { ...this.config, robotConfig: this.robotConfig };
    this.robotPreload = settings.robotPreload;
    this.hostTeamLabel = settings.teamLabel?.trim() || undefined;
    this.autoFollower.updateConstants({ mass: this.robotConfig.mass });
    const width = this.robotConfig.footprintWidth;
    const length = this.robotConfig.footprintLength;
    this.practiceLayouts = this.practiceLayouts.map((layout) => ({ ...layout, width, length }));
    for (const npc of this.npcMotion) {
      npc.width = width;
      npc.length = length;
    }
    this.refreshFieldRobots();
  }

  getHostRoomSettings(): HostRoomSettings {
    return {
      robotPreload: this.robotPreload,
      teamLabel: this.hostTeamLabel,
      robot: netRobotConfigFromSim(this.robotConfig),
    };
  }

  claimRobotSlot(robotId: string, teamLabel?: string): void {
    if (!isClaimableRobotId(robotId)) return;
    const pose = spawnPoseForClaimableSlot(robotId);
    const footprint = simRobotFootprint(this.robotConfig);
    this.claimedRobotIds.add(robotId);
    if (robotId === PLAYER_ROBOT_ID) {
      this.pose = { ...pose };
      this.linear = { x: 0, y: 0 };
      this.angular = 0;
    } else {
      const npc = this.npcMotion.find((entry) => entry.id === robotId);
      if (npc) {
        npc.pose = { ...pose };
        npc.linear = { x: 0, y: 0 };
        npc.angular = 0;
      }
    }
    if (teamLabel?.trim()) {
      this.setRobotTeamLabel(robotId, teamLabel);
    }
    this.world.setRobotSlotActive(robotId, true, pose, footprint);
    if (this.robotPreload && isClaimableRobotId(robotId)) {
      this.world.applyClaimedSlotPreload(
        robotId,
        allianceForClaimableSlot(robotId),
        pose,
        footprint,
      );
    }
    this.refreshFieldRobots();
  }

  releaseRobotSlot(robotId: string): void {
    if (!this.claimedRobotIds.delete(robotId)) return;
    this.clearRobotTeamLabel(robotId);
    this.world.setRobotSlotActive(robotId, false, { x: -64, y: -64, heading: 0 }, simRobotFootprint(this.robotConfig));
    this.refreshFieldRobots();
  }

  private isRobotClaimed(robotId: string): boolean {
    if (!this.config.onlyClaimedRobots) return true;
    return this.claimedRobotIds.has(robotId);
  }

  private activeNpcMotion(): NpcMotionState[] {
    return this.npcMotion.filter((npc) => this.isRobotClaimed(npc.id));
  }

  applyHostCommand(cmd: HostCommand): void {
    switch (cmd) {
      case 'init':
        this.clock.initMatch();
        break;
      case 'start_auto':
        this.clock.startAuto();
        this.startAutoFollower();
        break;
      case 'teleop':
        this.cancelAutoFollower();
        this.clock.startTeleop();
        break;
      case 'infinite':
        this.clock.startInfinitePractice();
        break;
      case 'pause':
        this.clock.pause();
        break;
      case 'resume':
        this.clock.resume();
        break;
      case 'end_match':
        this.clock.endMatch();
        break;
      case 'reset':
        this.reset();
        break;
    }
  }

  reset(poseOverride?: Pose): void {
    const spawn = poseOverride ?? this.config.startPose;
    this.pose = { ...spawn };
    this.linear = { x: 0, y: 0 };
    this.angular = 0;
    this.npcMotion = createNpcMotionStates(this.practiceLayouts);
    this.clock.reset();
    this.prevPhase = 'setup';
    this.tickIndex = 0;
    this.robotInputs.clear();
    this.injectedInput = null;
    this.cancelAutoFollower();
    this.world.reset(
      this.config.artifactStaging,
      spawn,
      this.buildNpcSync(),
      this.config.fixedMotif,
    );
    this.world.setArtifactFriction(this.artifactFriction);
    if (this.config.onlyClaimedRobots) {
      const claimed = [...this.claimedRobotIds];
      const labels = new Map(this.robotTeamLabels);
      this.claimedRobotIds.clear();
      this.world.setAllRobotSlotsInactive();
      this.pose = { ...PARKED_ROBOT_POSE };
      for (const npc of this.npcMotion) {
        npc.pose = { ...PARKED_ROBOT_POSE };
        npc.linear = { x: 0, y: 0 };
        npc.angular = 0;
      }
      for (const robotId of claimed) {
        this.claimRobotSlot(robotId, labels.get(robotId));
      }
    }
    this.refreshFieldRobots();
  }

  step(dt: number = PHYSICS_DT): void {
    if (!this.ready) return;

    const playerClaimed = this.isRobotClaimed(PLAYER_ROBOT_ID);
    const activeNpcs = this.activeNpcMotion();
    const sample = this.robotInputs.get(PLAYER_ROBOT_ID) ?? {
      input: { forward: 0, strafe: 0, turn: 0 },
      mechanism: { command: {}, shootEdge: false, gateEdge: false, shootHeld: false },
    };

    this.clock.tick(dt);
    this.applyMatchPhaseTransitions();

    const matchSnap = this.clock.snapshot();
    const matchActive = matchSnap.running && !matchSnap.paused;
    const phase = matchSnap.phase;
    const limits = simRobotLimits(this.robotConfig);
    const footprint = simRobotFootprint(this.robotConfig);

    let driveInput: import('@ftc-sim/robot').HolonomicInput = {
      forward: 0,
      strafe: 0,
      turn: 0,
    };
    let driveFrame: import('@ftc-sim/robot').DriveFrame = 'field';

    if (playerClaimed) {
      const resolved = resolveDriveInput(
        sample,
        this.injectedInput,
        matchSnap.allowsDrive,
        matchSnap.controlSource,
        phase,
        matchActive,
        this.follower,
        this.pose,
        this.linear,
        dt,
        limits,
      );
      driveInput = resolved.input;
      driveFrame = resolved.driveFrame;
    }

    const npcInputs: Record<string, import('@ftc-sim/robot').HolonomicInput> = {};
    const npcDriveFrames: Record<string, import('@ftc-sim/robot').DriveFrame> = {};
    for (const npc of activeNpcs) {
      const npcSample = this.robotInputs.get(npc.id);
      if (!npcSample || !matchSnap.allowsDrive) continue;
      npcInputs[npc.id] = {
        forward: npcSample.input.forward,
        strafe: npcSample.input.strafe,
        turn: npcSample.input.turn,
        brake: npcSample.input.brake,
        endpointBrake: npcSample.input.endpointBrake,
      };
      npcDriveFrames[npc.id] = npcSample.driveFrame ?? 'robot';
    }

    const multi = stepMultiRobotDrive({
      player: {
        pose: playerClaimed ? this.pose : PARKED_ROBOT_POSE,
        linear: playerClaimed ? this.linear : { x: 0, y: 0 },
        angular: playerClaimed ? this.angular : 0,
        input: driveInput,
      },
      npcs: activeNpcs,
      npcInputs,
      dt,
      limits,
      footprint,
      barriers: this.barrierPolys,
      fieldSizeInches: this.config.field.fieldSizeInches ?? 144,
      driveFrame,
      npcDriveFrames,
      maxAcceleration: this.robotConfig.maxAcceleration,
      maxAngularAcceleration: this.robotConfig.maxAngularAcceleration,
    });

    if (playerClaimed) {
      this.pose = multi.player.pose;
      this.linear = multi.player.linear;
      this.angular = multi.player.angular;
    }
    for (let i = 0; i < activeNpcs.length; i += 1) {
      const npcId = activeNpcs[i]!.id;
      const index = this.npcMotion.findIndex((entry) => entry.id === npcId);
      if (index < 0) continue;
      const updated = multi.npcs[i]!;
      this.npcMotion[index] = {
        ...this.npcMotion[index]!,
        pose: updated.pose,
        linear: updated.linear,
        angular: updated.angular,
      };
    }
    this.refreshFieldRobots();

    const emptySample: DriveSample = {
      input: { forward: 0, strafe: 0, turn: 0 },
      mechanism: { command: {}, shootEdge: false, gateEdge: false, shootHeld: false },
    };
    const autoMechanisms = phase === 'auto' || phase === 'transition';
    const robotTicks: RobotMechanismTickInput[] = [];
    if (playerClaimed) {
      const playerSample = this.robotInputs.get(PLAYER_ROBOT_ID) ?? emptySample;
      robotTicks.push(
        this.buildRobotMechanismTick(
          PLAYER_ROBOT_ID,
          this.pose,
          this.linear,
          this.config.alliance,
          playerSample,
          autoMechanisms,
        ),
      );
    }
    for (const npc of activeNpcs) {
      robotTicks.push(
        this.buildRobotMechanismTick(
          npc.id,
          npc.pose,
          npc.linear,
          npc.alliance,
          this.robotInputs.get(npc.id) ?? emptySample,
          false,
        ),
      );
    }

    this.world.tickRobots(
      dt,
      robotTicks,
      footprint,
      phase,
      this.buildMatchRobots(),
      phase === 'teleop' ? matchSnap.timeRemainingInPhase : undefined,
      this.buildNpcSync(),
    );

    this.tickIndex += 1;
  }

  getState(): SimSessionState {
    return {
      ready: this.ready,
      tickIndex: this.tickIndex,
      pose: { ...this.pose },
      linear: { ...this.linear },
      angular: this.angular,
      npcRobots: this.npcMotion.map((npc) => ({ ...npc, pose: { ...npc.pose }, linear: { ...npc.linear } })),
      fieldRobots: this.fieldRobots.map((robot) => ({
        ...robot,
        pose: { ...robot.pose },
      })),
      fieldRobotCatalog: [...this.fieldRobotCatalog],
      liveArtifacts: this.world.getRenderArtifacts(),
      matchGameState: this.world.getMatchState(),
      mechanismDebugLogs: this.world.getDebugLogs(),
      matchSnapshot: this.clock.snapshot(),
    };
  }

  buildNetSnapshot(maxEvents = 20, forceGameState = false): StateSnapshot {
    const state = this.getState();
    const matchState = state.matchGameState!;
    const events =
      matchState.events.length > maxEvents
        ? matchState.events.slice(-maxEvents)
        : matchState.events;
    const blueScore = matchState.byAlliance.blue.score.total;
    const redScore = matchState.byAlliance.red.score.total;
    const phase = state.matchSnapshot.phase;
    this.snapshotCounter += 1;
    const includeGameState =
      forceGameState ||
      this.snapshotCounter % 4 === 0 ||
      phase !== this.lastSnapshotPhase ||
      blueScore !== this.lastSnapshotScore.blue ||
      redScore !== this.lastSnapshotScore.red;
    if (includeGameState) {
      this.lastSnapshotPhase = phase;
      this.lastSnapshotScore = { blue: blueScore, red: redScore };
    }
    return {
      type: 'snapshot',
      tick: state.tickIndex,
      match: state.matchSnapshot,
      robots: state.fieldRobots.map((robot) => ({
        id: robot.id,
        alliance: robot.alliance,
        teamNumber: robot.teamNumber,
        width: robot.width,
        length: robot.length,
        pose: { ...robot.pose },
        linear:
          robot.id === PLAYER_ROBOT_ID
            ? { ...state.linear }
            : state.npcRobots.find((npc) => npc.id === robot.id)?.linear ?? { x: 0, y: 0 },
        angular:
          robot.id === PLAYER_ROBOT_ID
            ? state.angular
            : state.npcRobots.find((npc) => npc.id === robot.id)?.angular ?? 0,
      })),
      artifacts: state.liveArtifacts.map((artifact) => ({
        id: artifact.id,
        color: artifact.color,
        phase: artifact.phase,
        pose: { ...artifact.pose },
        opacity: artifact.opacity,
      })),
      score: {
        blue: blueScore,
        red: redScore,
        motif: matchState.obeliskMotif,
      },
      motif: matchState.obeliskMotif,
      gameState: includeGameState ? { ...matchState, events } : undefined,
      follower: (() => {
        if (!this.autoFollower.isRunning()) return undefined;
        const target = this.autoFollower.getTargetPose();
        if (!target) return undefined;
        return {
          running: true,
          completion: this.autoFollower.getProgress().completion,
          target,
        };
      })(),
    };
  }

  finalizeMatch(): ReturnType<ArtifactWorld['getMatchState']> | null {
    if (!this.ready) return null;
    const phase = this.clock.snapshot().phase;
    if (phase === 'auto' || phase === 'transition') {
      this.world.evaluateEndOfAuto(this.buildMatchRobots());
    }
    if (phase === 'auto' || phase === 'transition' || phase === 'teleop') {
      this.world.evaluateEndOfMatch(this.buildMatchRobots());
    }
    return this.world.getMatchState();
  }

  randomizeMotif(): void {
    this.world.randomizeMotif();
  }

  private applyMatchPhaseTransitions(): void {
    const phaseNow = this.clock.snapshot().phase;
    const prevPhase = this.prevPhase;
    if (prevPhase === phaseNow) return;

    if (prevPhase === 'auto' && phaseNow === 'transition') {
      this.cancelAutoFollower();
      this.world.evaluateEndOfAuto(this.buildMatchRobots());
    }
    if (prevPhase === 'teleop' && phaseNow === 'post') {
      this.world.evaluateEndOfMatch(this.buildMatchRobots());
    }
    this.prevPhase = phaseNow;
  }

  private refreshFieldRobots(): void {
    const built = buildFieldRobotRenderStates(
      this.pose,
      this.config.alliance,
      this.playerTeamNumber,
      simRobotFootprint(this.robotConfig),
      this.npcMotion,
    );
    this.fieldRobots = built
      .filter((robot) => this.isRobotClaimed(robot.id))
      .map((robot) => ({
        ...robot,
        teamNumber: this.robotTeamLabels.get(robot.id) ?? robot.teamNumber,
      }));
    this.fieldRobotCatalog = buildFieldRobotCatalog(this.practiceLayouts, {
      alliance: this.config.alliance,
      teamNumber: this.robotTeamLabels.get(PLAYER_ROBOT_ID) ?? this.playerTeamNumber,
      width: this.robotConfig.footprintWidth,
      length: this.robotConfig.footprintLength,
    }).map((entry) => ({
      ...entry,
      teamNumber: this.robotTeamLabels.get(entry.id) ?? entry.teamNumber,
    }));
  }

  private buildMatchRobots() {
    return matchRobotSnapshots(
      this.pose,
      this.config.alliance,
      this.activeNpcMotion(),
      simRobotFootprint(this.robotConfig),
    ).filter((robot) => this.isRobotClaimed(robot.id));
  }

  private buildNpcSync() {
    return this.activeNpcMotion().map((npc) => ({
      id: npc.id,
      pose: npc.pose,
      linear: npc.linear,
    }));
  }

  private buildRobotMechanismTick(
    robotId: string,
    pose: Pose,
    linear: { x: number; y: number },
    alliance: Alliance,
    sample: DriveSample,
    autoMechanisms: boolean,
  ): RobotMechanismTickInput {
    let mechanismCommand = sample.mechanism.command;
    let shootEdge = sample.mechanism.shootEdge;
    let shootHeld = sample.mechanism.shootHeld;
    const gateEdge = sample.mechanism.gateEdge;

    if (autoMechanisms && robotId === PLAYER_ROBOT_ID) {
      mechanismCommand = { ...mechanismCommand, intake: 1 };
      if (this.follower?.shouldAutoShoot?.()) {
        shootHeld = true;
      }
    }
    if (shootHeld) {
      shootEdge = false;
    }

    return {
      robotId,
      pose,
      linear,
      alliance,
      command: mechanismCommand,
      shootEdge,
      gateEdge,
      shootHeld,
    };
  }
}

export function hashSimState(session: SimSession): string {
  const state = session.getState();
  const payload = [
    state.tickIndex,
    state.pose.x.toFixed(4),
    state.pose.y.toFixed(4),
    state.pose.heading.toFixed(6),
    state.linear.x.toFixed(4),
    state.linear.y.toFixed(4),
    state.angular.toFixed(6),
    state.liveArtifacts.length,
    ...state.liveArtifacts.map(
      (a) => `${a.id}:${a.phase}:${a.pose.x.toFixed(2)},${a.pose.y.toFixed(2)}`,
    ),
    state.matchGameState?.byAlliance.blue.score.total ?? 0,
    state.matchGameState?.byAlliance.red.score.total ?? 0,
  ].join('|');

  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
