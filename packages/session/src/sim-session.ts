import type { FieldDefinition, Pose, StagedArtifactLayout } from '@ftc-sim/field';
import type { Alliance, MatchPhase } from '@ftc-sim/game-decode';
import type { HostCommand, InputFrame, StateSnapshot } from '@ftc-sim/net';
import { MatchClock } from '@ftc-sim/match';
import type { MechanismLogEntry, SimArtifactState } from '@ftc-sim/mechanisms';
import { stepMultiRobotDrive } from '@ftc-sim/robot';
import { ArtifactWorld, DEFAULT_ARTIFACT_FRICTION } from './artifact-world.js';
import { barrierPolygons, type SessionBarrier } from './barriers.js';
import { type AutoFollowerLike, type DriveSample, resolveDriveInput } from './drive-resolver.js';
import {
  buildFieldRobotCatalog,
  buildFieldRobotRenderStates,
  createNpcMotionStates,
  matchRobotSnapshots,
  PLAYER_ROBOT_ID,
  type FieldRobotCatalogEntry,
  type FieldRobotRenderState,
  type MatchRobotLayout,
  type NpcMotionState,
} from './match-robots.js';
import {
  DEFAULT_SIM_ROBOT_CONFIG,
  simRobotFootprint,
  simRobotLimits,
  type SimRobotConfig,
} from './robot-config.js';

export const PHYSICS_DT = 1 / 120;

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
  private injectedInput: import('@ftc-sim/robot').HolonomicInput | null = null;
  private pendingInput: DriveSample | null = null;

  constructor(config: SimSessionConfig) {
    this.config = config;
    this.robotConfig = config.robotConfig ?? DEFAULT_SIM_ROBOT_CONFIG;
    this.barriers = config.barriers;
    this.barrierPolys = barrierPolygons(config.barriers);
    this.pose = { ...config.startPose };
    this.playerTeamNumber = config.playerTeamNumber ?? '-4';
    this.practiceLayouts = config.practiceRobots ?? [];
    this.artifactFriction = config.artifactFriction ?? DEFAULT_ARTIFACT_FRICTION;
    this.world = new ArtifactWorld(config.field, config.alliance);
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
    this.pendingInput = sample;
  }

  applyInputFrame(frame: InputFrame): void {
    this.pendingInput = {
      input: {
        forward: frame.drive.forward,
        strafe: frame.drive.strafe,
        turn: frame.drive.turn,
        brake: frame.drive.brake,
        endpointBrake: frame.drive.endpointBrake,
      },
      mechanism: {
        command: frame.mechanism,
        shootEdge: frame.shootEdge,
        gateEdge: false,
        shootHeld: frame.mechanism.shoot ?? false,
      },
    };
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

  applyHostCommand(cmd: HostCommand): void {
    switch (cmd) {
      case 'init':
        this.clock.initMatch();
        break;
      case 'start_auto':
        this.clock.startAuto();
        break;
      case 'teleop':
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
    this.pendingInput = null;
    this.injectedInput = null;
    this.world.reset(
      this.config.artifactStaging,
      spawn,
      this.buildNpcSync(),
      this.config.fixedMotif,
    );
    this.world.setArtifactFriction(this.artifactFriction);
    this.refreshFieldRobots();
  }

  step(dt: number = PHYSICS_DT): void {
    if (!this.ready) return;

    const sample = this.pendingInput ?? {
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

    const { input: driveInput, driveFrame } = resolveDriveInput(
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

    const multi = stepMultiRobotDrive({
      player: {
        pose: this.pose,
        linear: this.linear,
        angular: this.angular,
        input: driveInput,
      },
      npcs: this.npcMotion,
      dt,
      limits,
      footprint,
      barriers: this.barrierPolys,
      fieldSizeInches: this.config.field.fieldSizeInches ?? 144,
      driveFrame,
      maxAcceleration: this.robotConfig.maxAcceleration,
      maxAngularAcceleration: this.robotConfig.maxAngularAcceleration,
    });

    this.pose = multi.player.pose;
    this.linear = multi.player.linear;
    this.angular = multi.player.angular;
    this.npcMotion = multi.npcs.map((npc, index) => ({
      ...this.npcMotion[index]!,
      pose: npc.pose,
      linear: npc.linear,
      angular: npc.angular,
    }));
    this.refreshFieldRobots();

    const autoMechanisms = phase === 'auto' || phase === 'transition';
    let mechanismCommand = sample.mechanism.command;
    let shootEdge = sample.mechanism.shootEdge;
    let shootHeld = sample.mechanism.shootHeld;

    if (autoMechanisms) {
      mechanismCommand = { ...mechanismCommand, intake: 1 };
      if (this.follower?.shouldAutoShoot?.()) {
        shootHeld = true;
      }
    }

    this.world.setShootHold(shootHeld);
    if (shootHeld) {
      shootEdge = false;
    }

    this.world.tick(
      dt,
      this.pose,
      this.linear,
      footprint,
      mechanismCommand,
      shootEdge,
      sample.mechanism.gateEdge,
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

  buildNetSnapshot(): StateSnapshot {
    const state = this.getState();
    const matchState = state.matchGameState!;
    return {
      type: 'snapshot',
      tick: state.tickIndex,
      match: state.matchSnapshot,
      robots: state.fieldRobots.map((robot) => ({
        id: robot.id,
        alliance: robot.alliance,
        teamNumber: robot.teamNumber,
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
        blue: matchState.byAlliance.blue.score.total,
        red: matchState.byAlliance.red.score.total,
        motif: matchState.obeliskMotif,
      },
      motif: matchState.obeliskMotif,
      gameState: matchState,
    };
  }

  finalizeMatch(): ReturnType<ArtifactWorld['getMatchState']> | null {
    if (!this.ready) return null;
    const phase = this.clock.snapshot().phase;
    if (phase === 'auto' || phase === 'transition') {
      this.world.evaluateEndOfAuto();
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
      this.world.evaluateEndOfAuto();
    }
    if (prevPhase === 'teleop' && phaseNow === 'post') {
      this.world.evaluateEndOfMatch(this.buildMatchRobots());
    }
    this.prevPhase = phaseNow;
  }

  private refreshFieldRobots(): void {
    this.fieldRobots = buildFieldRobotRenderStates(
      this.pose,
      this.config.alliance,
      this.playerTeamNumber,
      simRobotFootprint(this.robotConfig),
      this.npcMotion,
    );
  }

  private buildMatchRobots() {
    return matchRobotSnapshots(this.pose, this.config.alliance, this.npcMotion, simRobotFootprint(this.robotConfig));
  }

  private buildNpcSync() {
    return this.npcMotion.map((npc) => ({
      id: npc.id,
      pose: npc.pose,
      linear: npc.linear,
    }));
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
