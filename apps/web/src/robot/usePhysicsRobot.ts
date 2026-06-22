import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FieldDefinition, Pose, StagedArtifactLayout } from '@ftc-sim/field';
import type { Alliance, MatchState, MatchRobotSnapshot } from '@ftc-sim/game-decode';
import type { SimArtifactState, MechanismLogEntry } from '@ftc-sim/mechanisms';
import type { MatchPhase, MatchSnapshot } from '@ftc-sim/match';
import type { AutoSequenceRunner } from '@ftc-sim/pedro';
import {
  BotManager,
  defaultPracticeBotSlots,
  type BotDebugState,
  type BotSlotConfig,
} from '@ftc-sim/bot';
import {
  DEFAULT_KINEMATIC_ROBOT,
  stepMultiRobotDrive,
  type DriveFrame,
  type HolonomicInput,
} from '@ftc-sim/robot';
import {
  botSampleToDriveSample,
  buildBotWorldSnapshotFromWebContext,
  resolveDriveInput,
  simRobotFootprint,
  simRobotLimits,
} from '@ftc-sim/session';
import { ArtifactWorld, DEFAULT_ARTIFACT_FRICTION } from '../artifacts/artifact-world';
import type { DriveTelemetryFrame } from '../dev/inject-drive';
import type { EditableBarrier } from '../field/barrier-editor';
import type { DriveInputSamplerState } from '../input/drive-input-sampler';
import { sampleDriveInput } from '../input/drive-input-sampler';
import type { SimRobotConfig } from './robot-config';
import { DEFAULT_SIM_ROBOT_CONFIG } from './robot-config';
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

export interface PhysicsRobotHud {
  speed: number;
  angularSpeed: number;
}

export interface PhysicsRobotOptions {
  allowsDriveRef: RefObject<boolean>;
  matchActiveRef: RefObject<boolean>;
  driveBlockedRef?: RefObject<boolean>;
  getMatchSnapshotRef: RefObject<() => MatchSnapshot>;
  followerRef: RefObject<AutoSequenceRunner | null>;
  robotConfigRef: RefObject<SimRobotConfig>;
  onSimHudTick?: () => void;
  alliance: Alliance;
  artifactStaging: StagedArtifactLayout[];
  artifactFrictionRef?: RefObject<number>;
  getMatchStateRef?: RefObject<() => MatchState | null>;
  practiceRobotsRef?: RefObject<MatchRobotLayout[]>;
  playerTeamNumber?: string;
  teleopDriveFrameRef?: RefObject<DriveFrame>;
  robotPreloadRef?: RefObject<boolean>;
  botManagerRef?: RefObject<BotManager | null>;
  botsEnabledRef?: RefObject<boolean>;
  botSlotConfigsRef?: RefObject<BotSlotConfig[]>;
  botsEnabled?: boolean;
  humanInputRobotIdsRef?: RefObject<ReadonlySet<string>>;
}

export function usePhysicsRobot(
  field: FieldDefinition,
  barriers: EditableBarrier[],
  startPose: Pose,
  samplerRef: RefObject<DriveInputSamplerState>,
  sampleInputRef: RefObject<() => ReturnType<typeof sampleDriveInput>>,
  enabled: boolean,
  initWorld = true,
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
  const [botDebugLogs, setBotDebugLogs] = useState<import('@ftc-sim/bot').BotDebugLogEntry[]>([]);
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
  const lastFootprintRef = useRef({ width: 18, length: 18 });
  const barriersSyncedRef = useRef(false);
  const botDebugRef = useRef<BotDebugState[]>([]);
  const simTickIndexRef = useRef(0);
  const advanceSimulationRef = useRef<(steps: number) => void>(() => {});

  const allowsDriveRef = simOptions?.allowsDriveRef;
  const matchActiveRef = simOptions?.matchActiveRef;
  const driveBlockedRef = simOptions?.driveBlockedRef;
  const getMatchSnapshotRef = simOptions?.getMatchSnapshotRef;
  const followerRef = simOptions?.followerRef;
  const robotConfigRef = simOptions?.robotConfigRef;
  const onSimHudTick = simOptions?.onSimHudTick;
  const alliance = simOptions?.alliance ?? 'blue';
  const artifactStaging = simOptions?.artifactStaging ?? [];
  const artifactFrictionRef = simOptions?.artifactFrictionRef;
  const getMatchStateRef = simOptions?.getMatchStateRef;
  const practiceRobotsRef = simOptions?.practiceRobotsRef;
  const playerTeamNumber = simOptions?.playerTeamNumber ?? '-4';
  const robotPreloadRef = simOptions?.robotPreloadRef;
  const botManagerRef = simOptions?.botManagerRef;
  const botsEnabledRef = simOptions?.botsEnabledRef;
  const botSlotConfigsRef = simOptions?.botSlotConfigsRef;
  const botsEnabled = simOptions?.botsEnabled ?? botsEnabledRef?.current ?? false;

  useEffect(() => {
    const botManager = botManagerRef?.current;
    if (!botManager || !botsEnabled) return;
    botManager.setDebugLogging(true);
    botManager.setSlots(
      botSlotConfigsRef?.current ?? defaultPracticeBotSlots('normal'),
    );
  }, [botManagerRef, botsEnabled, botSlotConfigsRef]);

  const layoutOptions = useCallback(
    () => ({ preload: robotPreloadRef?.current ?? false }),
    [robotPreloadRef],
  );

  const applyPracticeBotPreloads = useCallback(() => {
    if (!botsEnabledRef?.current) return;
    const world = artifactWorldRef.current;
    const botManager = botManagerRef?.current;
    if (!world || !botManager) return;
    const robotConfig = robotConfigRef?.current ?? DEFAULT_SIM_ROBOT_CONFIG;
    const footprint = simRobotFootprint(robotConfig);
    for (const slot of botManager.getSlots()) {
      if (!slot.enabled) continue;
      const npc = npcMotionRef.current.find((entry) => entry.id === slot.robotId);
      if (!npc) continue;
      world.applyClaimedSlotPreload(npc.id, npc.alliance, npc.pose, footprint);
    }
  }, [botManagerRef, botsEnabledRef, robotConfigRef]);

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
      artifactWorldRef.current?.reset(artifactStaging, spawn, buildNpcSync(), undefined, layoutOptions());
      artifactWorldRef.current?.setArtifactFriction(artifactFrictionRef?.current ?? DEFAULT_ARTIFACT_FRICTION);
      if (artifactWorldRef.current) {
        const artifacts = artifactWorldRef.current.getRenderArtifacts();
        liveArtifactsRef.current = artifacts;
        setLiveArtifacts(artifacts);
        setMatchGameState(artifactWorldRef.current.getMatchState());
        setMechanismDebugLogs(artifactWorldRef.current.getDebugLogs());
      }
      prevMatchPhaseRef.current = 'setup';
      simTickIndexRef.current = 0;
      botManagerRef?.current?.reset();
      applyPracticeBotPreloads();
    },
    [startPose, artifactStaging, artifactFrictionRef, practiceRobotsRef, buildNpcSync, initFieldRobotCatalog, refreshFieldRobotsRef, layoutOptions, botManagerRef, applyPracticeBotPreloads],
  );

  const resetNpcPoses = useCallback(
    (poses: ReadonlyMap<string, Pose>) => {
      if (npcMotionRef.current.length === 0 || poses.size === 0) return;
      let changed = false;
      for (const npc of npcMotionRef.current) {
        const pose = poses.get(npc.id);
        if (!pose) continue;
        npc.pose = { ...pose };
        npc.linear = { x: 0, y: 0 };
        npc.angular = 0;
        changed = true;
      }
      if (!changed) return;
      refreshFieldRobotsRef();
      artifactWorldRef.current?.syncNpcRobots(buildNpcSync());
    },
    [buildNpcSync, refreshFieldRobotsRef],
  );

  useEffect(() => {
    if (!initWorld) {
      setReady(false);
      return;
    }

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

    void world.init(artifactStaging, initialBarriers, spawnPose, footprint, buildNpcSync(), layoutOptions())
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
        applyPracticeBotPreloads();
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
  }, [field, alliance, artifactStaging, practiceRobotsRef, buildNpcSync, initFieldRobotCatalog, refreshFieldRobotsRef, initWorld, layoutOptions, startPose, applyPracticeBotPreloads]);

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
        followerRef?.current?.cancelPath();
        const robots = buildMatchRobots();
        artifactWorldRef.current.evaluateEndOfAuto(robots);
      }
      if (prevPhase === 'teleop' && phaseNow === 'post') {
        const robots = buildMatchRobots();
        artifactWorldRef.current.evaluateEndOfMatch(robots);
      }
      prevMatchPhaseRef.current = phaseNow;
      setMatchGameState(artifactWorldRef.current.getMatchState());
    };

    const runSimulationSteps = (steps: number, dt: number) => {
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
      const robotConfig = robotConfigRef?.current;
      const limits = robotConfig ? simRobotLimits(robotConfig) : DEFAULT_KINEMATIC_ROBOT.limits;
      const footprint = robotConfig ? simRobotFootprint(robotConfig) : DEFAULT_KINEMATIC_ROBOT.footprint;
      let didSimulate = false;

      for (let i = 0; i < steps; i++) {
        const matchSnapNow = getMatchSnapshotRef?.current?.();
        const matchActive =
          matchSnapNow !== undefined
            ? matchSnapNow.running && !matchSnapNow.paused
            : (matchActiveRef?.current ?? true);
        const phase = matchSnapNow?.phase ?? 'setup';
        const shouldSimulateWorld =
          matchActive && (phase === 'auto' || phase === 'transition' || phase === 'teleop');

        if (matchActive || phase === 'post') {
          applyMatchPhaseTransitions();
        }
        if (!shouldSimulateWorld) {
          continue;
        }
        didSimulate = true;

        const allowsDrive =
          (matchSnapNow?.allowsDrive ?? allowsDriveRef?.current ?? false) &&
          !(driveBlockedRef?.current ?? false);
        const controlSource = matchSnapNow?.controlSource ?? 'none';
        const follower = followerRef?.current ?? null;

        const { input: driveInput, driveFrame } = resolveDriveInput(
          {
            input: sample.input,
            driveFrame: simOptions?.teleopDriveFrameRef?.current ?? 'field',
            mechanism: sample.mechanism,
          },
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

        const botSamples = new Map<string, ReturnType<typeof botSampleToDriveSample>>();
        const botManager = botManagerRef?.current;
        const botsEnabled = botsEnabledRef?.current ?? false;
        const botDriveAllowed =
          allowsDrive || phase === 'auto' || phase === 'transition';

        if (botsEnabled && botManager && matchActive && npcMotionRef.current.length > 0) {
          const mechanismSnap = artifactWorldRef.current?.getSnapshot();
          const world = buildBotWorldSnapshotFromWebContext({
            tickIndex: simTickIndexRef.current,
            match: matchSnapNow!,
            field,
            playerAlliance: alliance,
            playerPose: poseRef.current,
            playerLinear: linearRef.current,
            playerAngular: angularRef.current,
            playerStored: mechanismSnap?.stored ?? [],
            npcRobots: npcMotionRef.current.map((npc) => ({
              id: npc.id,
              alliance: npc.alliance,
              pose: npc.pose,
              linear: npc.linear,
              angular: npc.angular,
              stored: mechanismSnap?.byRobot[npc.id]?.stored ?? [],
            })),
            artifacts: liveArtifactsRef.current.map((artifact) => ({
              id: artifact.id,
              color: artifact.color,
              phase: artifact.phase,
              pose: { ...artifact.pose },
              source: artifact.source,
            })),
            gameState: artifactWorldRef.current?.getMatchState() ?? null,
            barriers: barriersRef.current,
            footprint,
            limits,
            robotConfig: {
              mass: robotConfig?.mass ?? 40,
              maxAcceleration: robotConfig?.maxAcceleration ?? 48,
              maxAngularAcceleration: robotConfig?.maxAngularAcceleration ?? 18,
            },
            humanInputRobotIds: simOptions?.humanInputRobotIdsRef?.current ?? new Set([PLAYER_ROBOT_ID]),
            botSlots: botManager.getSlots(),
          });
          const botOutputs = botManager.tick(world, dt);
          for (const [robotId, sample] of botOutputs) {
            if (botManager.isBotControlled(robotId)) {
              botSamples.set(robotId, botSampleToDriveSample(sample));
            }
          }
          botDebugRef.current = botManager.getDebugStates();
        } else {
          botDebugRef.current = [];
        }

        const npcInputs: Record<string, HolonomicInput> = {};
        const npcDriveFrames: Record<string, DriveFrame> = {};
        for (const npc of npcMotionRef.current) {
          const botSample = botSamples.get(npc.id);
          if (botSample && botDriveAllowed) {
            npcInputs[npc.id] = {
              forward: botSample.input.forward,
              strafe: botSample.input.strafe,
              turn: botSample.input.turn,
              brake: botSample.input.brake,
              endpointBrake: botSample.input.endpointBrake,
            };
            npcDriveFrames[npc.id] = botSample.driveFrame ?? 'field';
          }
        }

        const multi = stepMultiRobotDrive({
          player: {
            pose: poseRef.current,
            linear: linearRef.current,
            angular: angularRef.current,
            input: driveInput,
          },
          npcs: npcMotionRef.current,
          npcInputs,
          dt,
          limits,
          footprint,
          barriers: barriersRef.current,
          fieldSizeInches: 144,
          driveFrame,
          npcDriveFrames,
          maxAcceleration: robotConfig?.maxAcceleration ?? 48,
          maxAngularAcceleration: robotConfig?.maxAngularAcceleration ?? 18,
          playerPriority: phase === 'auto' || phase === 'transition',
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

        if (
          footprint.width !== lastFootprintRef.current.width ||
          footprint.length !== lastFootprintRef.current.length
        ) {
          lastFootprintRef.current = { width: footprint.width, length: footprint.length };
          artifactWorldRef.current?.syncRobotFootprint(footprint);
          initFieldRobotCatalog();
        }

        refreshFieldRobotsRef();

        if (artifactFrictionRef) {
          artifactWorldRef.current?.setArtifactFriction(artifactFrictionRef.current);
        }

        const autoMechanisms = phase === 'auto' || phase === 'transition';
        const mechanismsAllowed =
          phase === 'auto' || phase === 'transition' || phase === 'teleop';
        let mechanismCommand = sample.mechanism.command;
        let shootEdge = sample.mechanism.shootEdge;
        let shootHeld = sample.mechanism.shootHeld;

        if (!mechanismsAllowed) {
          mechanismCommand = {};
          shootEdge = false;
          shootHeld = false;
        } else if (autoMechanisms) {
          mechanismCommand = { ...mechanismCommand, intake: 1 };
          if (follower?.shouldAutoShoot()) {
            shootHeld = true;
          }
        }

        if (shootHeld) {
          shootEdge = false;
        }

        const allianceForMech = simOptions?.alliance ?? 'blue';
        artifactWorldRef.current?.tickRobots(
          dt,
          [
            {
              robotId: PLAYER_ROBOT_ID,
              pose: poseRef.current,
              linear: linearRef.current,
              alliance: allianceForMech,
              command: mechanismCommand,
              shootEdge,
              gateEdge: sample.mechanism.gateEdge,
              shootHeld,
            },
            ...npcMotionRef.current.map((npc) => {
              const botSample = botSamples.get(npc.id);
              const isBot = botsEnabled && botManager?.isBotControlled(npc.id);
              const command =
                isBot && mechanismsAllowed
                  ? (botSample?.mechanism.command ?? { intake: 1 })
                  : {};
              return {
                robotId: npc.id,
                pose: npc.pose,
                linear: npc.linear,
                alliance: npc.alliance,
                command,
                shootEdge: botSample?.mechanism.shootEdge ?? false,
                gateEdge: botSample?.mechanism.gateEdge ?? false,
                shootHeld: botSample?.mechanism.shootHeld ?? false,
              };
            }),
          ],
          footprint,
          phase,
          buildMatchRobots(),
          matchSnapNow?.phase === 'teleop' ? matchSnapNow.timeRemainingInPhase : undefined,
          buildNpcSync(),
        );
        if (artifactWorldRef.current) {
          liveArtifactsRef.current = artifactWorldRef.current.getRenderArtifacts();
        }
        simTickIndexRef.current += 1;
      }

      if (!didSimulate) {
        const sampleForHud = sampleInputRef.current?.() ?? null;
        if (sampleForHud) {
          onHudTick?.(sampleForHud.debug, sampleForHud.source, samplerRef.current?.gamepadConnected ?? false);
        }
        onSimHudTick?.();
        return;
      }

      pushTelemetry(lastDriveInputRef.current);
      setPose({ ...poseRef.current });
      const speed = Math.hypot(linearRef.current.x, linearRef.current.y);
      setHud({ speed, angularSpeed: angularRef.current });
      if (artifactWorldRef.current) {
        setLiveArtifacts(artifactWorldRef.current.getRenderArtifacts());
        setMatchGameState(artifactWorldRef.current.getMatchState());
        setMechanismDebugLogs(artifactWorldRef.current.getDebugLogs());
        if (botsEnabledRef?.current && botManagerRef?.current) {
          setBotDebugLogs(botManagerRef.current.getDebugLogs());
        }
      }
      onHudTick?.(sample.debug, sample.source, samplerRef.current?.gamepadConnected ?? false);
      onSimHudTick?.();
    };

    advanceSimulationRef.current = (steps: number) => {
      if (!enabledRef.current || steps <= 0) return;
      runSimulationSteps(steps, 1 / 120);
    };

    const tick = (now: number) => {
      const { steps, dt } = advanceAccumulator(accRef.current, now);

      if (enabledRef.current && steps > 0) {
        runSimulationSteps(steps, dt);
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
    onSimHudTick,
    buildMatchRobots,
    buildNpcSync,
    refreshFieldRobotsRef,
    initFieldRobotCatalog,
      botManagerRef,
      botsEnabledRef,
      botSlotConfigsRef,
      botsEnabled,
      field,
    alliance,
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

    const robots = buildMatchRobots();
    const phase = getMatchSnapshotRef?.current?.().phase ?? 'setup';
    if (phase === 'auto' || phase === 'transition') {
      world.evaluateEndOfAuto(robots);
    }
    world.evaluateEndOfMatch(robots);

    const state = world.getMatchState();
    setMatchGameState(state);
    const artifacts = world.getRenderArtifacts();
    liveArtifactsRef.current = artifacts;
    setLiveArtifacts(artifacts);
    setMechanismDebugLogs(world.getDebugLogs());
    return state;
  }, [getMatchSnapshotRef, robotConfigRef, buildMatchRobots]);

  const advanceSimulation = useCallback((steps: number) => {
    advanceSimulationRef.current(steps);
  }, []);

  return {
    pose,
    poseRef,
    speed: hud.speed,
    angularSpeed: hud.angularSpeed,
    ready,
    reset,
    resetNpcPoses,
    physicsEvents,
    linearRef,
    angularRef,
    samplerRef,
    getTelemetry,
    liveArtifacts,
    liveArtifactsRef,
    matchGameState,
    mechanismDebugLogs,
    botDebugLogs,
    botDebugRef,
    setArtifactFriction,
    randomizeMotif,
    finalizeMatch,
    advanceSimulation,
    fieldRobotsRef,
    fieldRobotCatalog,
  };
}
