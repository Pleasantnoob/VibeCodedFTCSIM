import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FieldDefinition, Pose, StagedArtifactLayout } from '@ftc-sim/field';
import type { Alliance, MatchState, MatchRobotSnapshot } from '@ftc-sim/game-decode';
import type { SimArtifactState, MechanismLogEntry } from '@ftc-sim/mechanisms';
import type { ControlSource as MatchControlSource, MatchPhase, MatchSnapshot } from '@ftc-sim/match';
import type { AutoSequenceRunner } from '@ftc-sim/pedro';
import {
  DEFAULT_KINEMATIC_ROBOT,
  stepMultiRobotDrive,
  type DriveFrame,
  type HolonomicInput,
} from '@ftc-sim/robot';
import { ArtifactWorld, DEFAULT_ARTIFACT_FRICTION } from '../artifacts/artifact-world';
import type { DriveTelemetryFrame } from '../dev/inject-drive';
import type { EditableBarrier } from '../field/barrier-editor';
import type { DriveInputSamplerState } from '../input/drive-input-sampler';
import { sampleDriveInput } from '../input/drive-input-sampler';
import type { SimRobotConfig } from './robot-config';
import { DEFAULT_SIM_ROBOT_CONFIG, simRobotFootprint, simRobotLimits } from './robot-config';
import {
  buildFieldRobotCatalog,
  buildFieldRobotRenderStates,
  createNpcMotionStates,
  matchRobotSnapshots,
  type FieldRobotCatalogEntry,
  type FieldRobotRenderState,
  type MatchRobotLayout,
  type NpcMotionState,
} from './match-robots';
import {
  advanceAccumulator,
  createGameLoopAccumulator,
  shouldUpdateHud,
} from './game-loop';

const ZERO_INPUT: HolonomicInput = { forward: 0, strafe: 0, turn: 0 };
const TELEMETRY_FRAMES = 600;

function barrierPolygons(barriers: EditableBarrier[]) {
  return barriers.map((barrier) => barrier.vertices.map((v) => ({ x: v.x, y: v.y })));
}

function resolveDriveInput(
  sample: ReturnType<typeof sampleDriveInput>,
  injected: HolonomicInput | null | undefined,
  allowsDrive: boolean,
  controlSource: MatchControlSource,
  phase: MatchPhase,
  matchActive: boolean,
  follower: AutoSequenceRunner | null | undefined,
  pose: Pose,
  linear: { x: number; y: number },
  dt: number,
  limits: ReturnType<typeof simRobotLimits>,
): { input: HolonomicInput; driveFrame: DriveFrame } {
  if (injected) {
    return { input: injected, driveFrame: 'field' };
  }

  const autoDrive =
    matchActive &&
    controlSource === 'autonomous' &&
    (phase === 'auto' || phase === 'transition') &&
    (follower?.isRunning() ?? false);

  if (autoDrive && follower) {
    follower.setPose(pose);
    follower.setVelocity(linear);
    const input = follower.updateHolonomic(dt, limits);
    return {
      input,
      driveFrame: 'robot',
    };
  }

  if (
    matchActive &&
    controlSource === 'autonomous' &&
    (phase === 'auto' || phase === 'transition')
  ) {
    return {
      input: { forward: 0, strafe: 0, turn: 0, brake: true, endpointBrake: true },
      driveFrame: 'field',
    };
  }

  if (allowsDrive) {
    return { input: sample.input, driveFrame: 'field' };
  }

  return { input: ZERO_INPUT, driveFrame: 'field' };
}

export interface PhysicsRobotHud {
  speed: number;
  angularSpeed: number;
}

export interface PhysicsRobotOptions {
  allowsDriveRef: RefObject<boolean>;
  matchActiveRef: RefObject<boolean>;
  getMatchSnapshotRef: RefObject<() => MatchSnapshot>;
  followerRef: RefObject<AutoSequenceRunner | null>;
  robotConfigRef: RefObject<SimRobotConfig>;
  onPhysicsStepRef: RefObject<(dt: number) => void>;
  onSimHudTick?: () => void;
  alliance: Alliance;
  artifactStaging: StagedArtifactLayout[];
  artifactFrictionRef?: RefObject<number>;
  getMatchStateRef?: RefObject<() => MatchState | null>;
  practiceRobotsRef?: RefObject<MatchRobotLayout[]>;
  playerTeamNumber?: string;
}

export function usePhysicsRobot(
  field: FieldDefinition,
  barriers: EditableBarrier[],
  startPose: Pose,
  samplerRef: RefObject<DriveInputSamplerState>,
  sampleInputRef: RefObject<() => ReturnType<typeof sampleDriveInput>>,
  enabled: boolean,
  onHudTick?: (
    debug: ReturnType<typeof sampleDriveInput>['debug'],
    source: string,
    connected: boolean,
  ) => void,
  simOptions?: PhysicsRobotOptions,
) {
  const [pose, setPose] = useState<Pose>(startPose);
  const [hud, setHud] = useState<PhysicsRobotHud>({ speed: 0, angularSpeed: 0 });
  const [ready, setReady] = useState(false);
  const [liveArtifacts, setLiveArtifacts] = useState<SimArtifactState[]>([]);
  const [matchGameState, setMatchGameState] = useState<MatchState | null>(null);
  const [mechanismDebugLogs, setMechanismDebugLogs] = useState<MechanismLogEntry[]>([]);
  const [physicsEvents, setPhysicsEvents] = useState<string[]>(['[info] Initializing physics…']);
  const [fieldRobotCatalog, setFieldRobotCatalog] = useState<FieldRobotCatalogEntry[]>([]);

  const poseRef = useRef<Pose>(startPose);
  const linearRef = useRef({ x: 0, y: 0 });
  const angularRef = useRef(0);
  const npcMotionRef = useRef<NpcMotionState[]>([]);
  const fieldRobotsRef = useRef<FieldRobotRenderState[]>([]);
  const barriersRef = useRef(barrierPolygons(barriers));
  const enabledRef = useRef(enabled);
  const loopRef = useRef<number | null>(null);
  const accRef = useRef(createGameLoopAccumulator());
  const telemetryRef = useRef<DriveTelemetryFrame[]>([]);
  const lastDriveInputRef = useRef<HolonomicInput>(ZERO_INPUT);
  const artifactWorldRef = useRef<ArtifactWorld | null>(null);
  const liveArtifactsRef = useRef<SimArtifactState[]>([]);
  const prevMatchPhaseRef = useRef<MatchPhase>('setup');
  const barriersSyncedRef = useRef(false);

  const allowsDriveRef = simOptions?.allowsDriveRef;
  const matchActiveRef = simOptions?.matchActiveRef;
  const getMatchSnapshotRef = simOptions?.getMatchSnapshotRef;
  const followerRef = simOptions?.followerRef;
  const robotConfigRef = simOptions?.robotConfigRef;
  const onPhysicsStepRef = simOptions?.onPhysicsStepRef;
  const onSimHudTick = simOptions?.onSimHudTick;
  const alliance = simOptions?.alliance ?? 'blue';
  const artifactStaging = simOptions?.artifactStaging ?? [];
  const artifactFrictionRef = simOptions?.artifactFrictionRef;
  const getMatchStateRef = simOptions?.getMatchStateRef;
  const practiceRobotsRef = simOptions?.practiceRobotsRef;
  const playerTeamNumber = simOptions?.playerTeamNumber ?? '-4';

  const refreshFieldRobotsRef = useCallback(() => {
    const robotConfig = robotConfigRef?.current ?? DEFAULT_SIM_ROBOT_CONFIG;
    fieldRobotsRef.current = buildFieldRobotRenderStates(
      poseRef.current,
      alliance,
      playerTeamNumber,
      {
        width: robotConfig.footprintWidth,
        length: robotConfig.footprintLength,
      },
      npcMotionRef.current,
    );
  }, [robotConfigRef, alliance, playerTeamNumber]);

  const buildMatchRobots = useCallback((): MatchRobotSnapshot[] => {
    const robotConfig = robotConfigRef?.current ?? DEFAULT_SIM_ROBOT_CONFIG;
    return matchRobotSnapshots(poseRef.current, alliance, npcMotionRef.current, {
      width: robotConfig.footprintWidth,
      length: robotConfig.footprintLength,
    });
  }, [robotConfigRef, alliance]);

  const buildNpcSync = useCallback(() => {
    return npcMotionRef.current.map((npc) => ({
      id: npc.id,
      pose: npc.pose,
      linear: npc.linear,
    }));
  }, []);

  const initFieldRobotCatalog = useCallback(() => {
    const layouts = practiceRobotsRef?.current ?? [];
    const robotConfig = robotConfigRef?.current ?? DEFAULT_SIM_ROBOT_CONFIG;
    const catalog = buildFieldRobotCatalog(layouts, {
      alliance,
      teamNumber: playerTeamNumber,
      width: robotConfig.footprintWidth,
      length: robotConfig.footprintLength,
    });
    setFieldRobotCatalog(catalog);
    return catalog;
  }, [practiceRobotsRef, robotConfigRef, alliance, playerTeamNumber]);

  barriersRef.current = barrierPolygons(barriers);
  enabledRef.current = enabled;

  if (getMatchStateRef) {
    getMatchStateRef.current = () => artifactWorldRef.current?.getMatchState() ?? null;
  }

  const pushTelemetry = useCallback((input: HolonomicInput) => {
    const frame: DriveTelemetryFrame = {
      input: { ...input },
      linear: { ...linearRef.current },
      angular: angularRef.current,
      pose: { ...poseRef.current },
      speed: Math.hypot(linearRef.current.x, linearRef.current.y),
    };
    telemetryRef.current.push(frame);
    if (telemetryRef.current.length > TELEMETRY_FRAMES) {
      telemetryRef.current.shift();
    }
  }, []);

  const getTelemetry = useCallback(() => [...telemetryRef.current], []);

  const setArtifactFriction = useCallback((friction: number) => {
    artifactWorldRef.current?.setArtifactFriction(friction);
  }, []);

  const reset = useCallback(
    (poseOverride?: Pose) => {
      const spawn = poseOverride ?? startPose;
      const layouts = practiceRobotsRef?.current ?? [];
      npcMotionRef.current = createNpcMotionStates(layouts);
      initFieldRobotCatalog();
      refreshFieldRobotsRef();
      poseRef.current = spawn;
      linearRef.current = { x: 0, y: 0 };
      angularRef.current = 0;
      lastDriveInputRef.current = ZERO_INPUT;
      setPose(spawn);
      setHud({ speed: 0, angularSpeed: 0 });
      accRef.current = createGameLoopAccumulator();
      telemetryRef.current = [];
      artifactWorldRef.current?.reset(artifactStaging, spawn, buildNpcSync());
      artifactWorldRef.current?.setArtifactFriction(artifactFrictionRef?.current ?? DEFAULT_ARTIFACT_FRICTION);
      if (artifactWorldRef.current) {
        const artifacts = artifactWorldRef.current.getRenderArtifacts();
        liveArtifactsRef.current = artifacts;
        setLiveArtifacts(artifacts);
        setMatchGameState(artifactWorldRef.current.getMatchState());
        setMechanismDebugLogs(artifactWorldRef.current.getDebugLogs());
      }
      prevMatchPhaseRef.current = 'setup';
    },
    [startPose, artifactStaging, artifactFrictionRef, practiceRobotsRef, buildNpcSync, initFieldRobotCatalog, refreshFieldRobotsRef],
  );

  useEffect(() => {
    let cancelled = false;
    const world = new ArtifactWorld(field, alliance);
    artifactWorldRef.current = world;
    const robotConfig = robotConfigRef?.current ?? DEFAULT_SIM_ROBOT_CONFIG;
    const footprint = simRobotFootprint(robotConfig);
    const spawnPose = startPose;
    const initialBarriers = barriers;
    const npcLayouts = practiceRobotsRef?.current ?? [];
    npcMotionRef.current = createNpcMotionStates(npcLayouts);
    initFieldRobotCatalog();

    void world.init(artifactStaging, initialBarriers, spawnPose, footprint, buildNpcSync())
      .then(() => {
        if (cancelled) return;
        poseRef.current = spawnPose;
        linearRef.current = { x: 0, y: 0 };
        angularRef.current = 0;
        setPose(spawnPose);
        setHud({ speed: 0, angularSpeed: 0 });
        refreshFieldRobotsRef();
        setLiveArtifacts(world.getRenderArtifacts());
        liveArtifactsRef.current = world.getRenderArtifacts();
        world.randomizeMotif();
        setMatchGameState(world.getMatchState());
        setMechanismDebugLogs(world.getDebugLogs());
        world.setArtifactFriction(artifactFrictionRef?.current ?? DEFAULT_ARTIFACT_FRICTION);
        setPhysicsEvents(['[info] Rapier artifacts ready', '[info] Kinematic drive + mechanisms ready']);
        setReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setPhysicsEvents([`[error] Physics init failed: ${error instanceof Error ? error.message : String(error)}`]);
        setReady(true);
      });

    return () => {
      cancelled = true;
      world.destroy();
      artifactWorldRef.current = null;
      setReady(false);
    };
  }, [field, alliance, artifactStaging, practiceRobotsRef, buildNpcSync, initFieldRobotCatalog, refreshFieldRobotsRef]);

  useEffect(() => {
    if (!ready) {
      barriersSyncedRef.current = false;
      return;
    }
    if (!barriersSyncedRef.current) {
      barriersSyncedRef.current = true;
      return;
    }
    artifactWorldRef.current?.syncBarriers(barriers);
  }, [barriers, ready]);

  useEffect(() => {
    if (!ready) return;

    const applyMatchPhaseTransitions = () => {
      if (!artifactWorldRef.current) return;
      const phaseNow = getMatchSnapshotRef?.current?.().phase ?? 'setup';
      const prevPhase = prevMatchPhaseRef.current;
      if (prevPhase === phaseNow) return;

      if (prevPhase === 'auto' && phaseNow === 'transition') {
        artifactWorldRef.current.evaluateEndOfAuto();
      }
      if (prevPhase === 'teleop' && phaseNow === 'post') {
        const robots = buildMatchRobots();
        artifactWorldRef.current.evaluateEndOfMatch(robots);
      }
      prevMatchPhaseRef.current = phaseNow;
      setMatchGameState(artifactWorldRef.current.getMatchState());
    };

    const tick = (now: number) => {
      const { steps, dt } = advanceAccumulator(accRef.current, now);

      const matchSnapNow = getMatchSnapshotRef?.current?.();
      const matchActive =
        matchSnapNow !== undefined
          ? matchSnapNow.running && !matchSnapNow.paused
          : (matchActiveRef?.current ?? true);

      const phase = matchSnapNow?.phase ?? 'setup';

      if (enabledRef.current && matchActive && steps > 0) {
        const sample =
          sampleInputRef.current?.() ??
          ({
            input: ZERO_INPUT,
            debug: {
              rawForward: 0,
              rawStrafe: 0,
              rawTurn: 0,
              forward: 0,
              strafe: 0,
              turn: 0,
              source: 'none' as const,
              padAxes: [0, 0, 0, 0] as [number, number, number, number],
              intake: 0,
              shoot: false,
              gate: false,
            },
            mechanism: {
              command: {},
              shootEdge: false,
              gateEdge: false,
              shootHeld: false,
            },
            source: 'none' as const,
          } satisfies ReturnType<typeof sampleDriveInput>);

        const injected = samplerRef.current?.injectInput;
        const allowsDrive = allowsDriveRef?.current ?? true;
        const controlSource = matchSnapNow?.controlSource ?? 'none';
        const follower = followerRef?.current ?? null;
        const robotConfig = robotConfigRef?.current;
        const limits = robotConfig ? simRobotLimits(robotConfig) : DEFAULT_KINEMATIC_ROBOT.limits;
        const footprint = robotConfig ? simRobotFootprint(robotConfig) : DEFAULT_KINEMATIC_ROBOT.footprint;

        for (let i = 0; i < steps; i++) {
          onPhysicsStepRef?.current?.(dt);
          applyMatchPhaseTransitions();
          const { input: driveInput, driveFrame } = resolveDriveInput(
            sample,
            injected,
            allowsDrive,
            controlSource,
            phase,
            matchActive,
            follower,
            poseRef.current,
            linearRef.current,
            dt,
            limits,
          );
          lastDriveInputRef.current = driveInput;

          const multi = stepMultiRobotDrive({
            player: {
              pose: poseRef.current,
              linear: linearRef.current,
              angular: angularRef.current,
              input: driveInput,
            },
            npcs: npcMotionRef.current,
            dt,
            limits,
            footprint,
            barriers: barriersRef.current,
            fieldSizeInches: 144,
            driveFrame,
            maxAcceleration: robotConfig?.maxAcceleration ?? 48,
            maxAngularAcceleration: robotConfig?.maxAngularAcceleration ?? 18,
          });
          poseRef.current = multi.player.pose;
          linearRef.current = multi.player.linear;
          angularRef.current = multi.player.angular;
          npcMotionRef.current = multi.npcs.map((npc, index) => ({
            ...npcMotionRef.current[index]!,
            pose: npc.pose,
            linear: npc.linear,
            angular: npc.angular,
          }));

          refreshFieldRobotsRef();

          if (artifactFrictionRef) {
            artifactWorldRef.current?.setArtifactFriction(artifactFrictionRef.current);
          }

          const autoMechanisms = phase === 'auto' || phase === 'transition';
          let mechanismCommand = sample.mechanism.command;
          let shootEdge = sample.mechanism.shootEdge;
          let shootHeld = sample.mechanism.shootHeld;

          if (autoMechanisms) {
            mechanismCommand = { ...mechanismCommand, intake: 1 };
            if (follower?.shouldAutoShoot()) {
              shootHeld = true;
            }
          }

          artifactWorldRef.current?.setShootHold(shootHeld);
          if (shootHeld) {
            shootEdge = false;
          }

          artifactWorldRef.current?.tick(
            dt,
            poseRef.current,
            linearRef.current,
            footprint,
            mechanismCommand,
            shootEdge,
            sample.mechanism.gateEdge,
            phase,
            buildMatchRobots(),
            matchSnapNow?.phase === 'teleop' ? matchSnapNow.timeRemainingInPhase : undefined,
            buildNpcSync(),
          );
          if (artifactWorldRef.current) {
            liveArtifactsRef.current = artifactWorldRef.current.getRenderArtifacts();
          }
        }

        pushTelemetry(lastDriveInputRef.current);

        if (shouldUpdateHud(accRef.current, now)) {
          setPose({ ...poseRef.current });
          const speed = Math.hypot(linearRef.current.x, linearRef.current.y);
          setHud({ speed, angularSpeed: angularRef.current });
          if (artifactWorldRef.current) {
            setLiveArtifacts(artifactWorldRef.current.getRenderArtifacts());
            setMatchGameState(artifactWorldRef.current.getMatchState());
            setMechanismDebugLogs(artifactWorldRef.current.getDebugLogs());
          }
          onHudTick?.(sample.debug, sample.source, samplerRef.current?.gamepadConnected ?? false);
          onSimHudTick?.();
        }
      } else if (shouldUpdateHud(accRef.current, now) && enabledRef.current) {
        const sample = sampleInputRef.current?.() ?? null;
        if (sample) {
          onHudTick?.(sample.debug, sample.source, samplerRef.current?.gamepadConnected ?? false);
        }
        onSimHudTick?.();
      }

      loopRef.current = requestAnimationFrame(tick);
    };

    loopRef.current = requestAnimationFrame(tick);
    return () => {
      if (loopRef.current !== null) cancelAnimationFrame(loopRef.current);
    };
  }, [
    ready,
    sampleInputRef,
    onHudTick,
    onSimHudTick,
    pushTelemetry,
    samplerRef,
    allowsDriveRef,
    matchActiveRef,
    getMatchSnapshotRef,
    followerRef,
    robotConfigRef,
    onPhysicsStepRef,
    buildMatchRobots,
    buildNpcSync,
    refreshFieldRobotsRef,
  ]);

  const randomizeMotif = useCallback(() => {
    artifactWorldRef.current?.randomizeMotif();
    if (artifactWorldRef.current) {
      setMatchGameState(artifactWorldRef.current.getMatchState());
    }
  }, []);

  const finalizeMatch = useCallback(() => {
    const world = artifactWorldRef.current;
    if (!world) return null;

    const phase = getMatchSnapshotRef?.current?.().phase ?? 'setup';

    if (phase === 'auto' || phase === 'transition') {
      world.evaluateEndOfAuto();
    }
    if (phase === 'auto' || phase === 'transition' || phase === 'teleop') {
      const robots = buildMatchRobots();
      world.evaluateEndOfMatch(robots);
    }

    const state = world.getMatchState();
    setMatchGameState(state);
    const artifacts = world.getRenderArtifacts();
    liveArtifactsRef.current = artifacts;
    setLiveArtifacts(artifacts);
    setMechanismDebugLogs(world.getDebugLogs());
    return state;
  }, [getMatchSnapshotRef, robotConfigRef, buildMatchRobots]);

  return {
    pose,
    poseRef,
    speed: hud.speed,
    angularSpeed: hud.angularSpeed,
    ready,
    reset,
    physicsEvents,
    linearRef,
    angularRef,
    samplerRef,
    getTelemetry,
    liveArtifacts,
    liveArtifactsRef,
    matchGameState,
    mechanismDebugLogs,
    setArtifactFriction,
    randomizeMotif,
    finalizeMatch,
    fieldRobotsRef,
    fieldRobotCatalog,
  };
}
