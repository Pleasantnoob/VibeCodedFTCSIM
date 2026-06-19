# Simulation API Reference (v2)

## MatchDirector / SimulationEngine

`SimulationEngine` is an alias for `MatchDirector` — the v2 orchestrator.

```typescript
interface MatchDirector {
  init(): Promise<void>;
  loadScenario(scenario: ScenarioConfig): void;
  reset(seed?: number): Promise<void>;
  initMatch(): void;
  start(): void;
  startTeleop(): void;
  pause(): void;
  resume(): void;
  step(frames?: number): void;
  update(): void;
  getState(): MatchDirectorState;
  getMatchState(): MatchState | null;
  getAnalytics(): MatchAnalytics;
  getInputManager(): InputManager;
  loadPath(robotId: string, pathChain: PathChain): void;
  loadPathFromJson(robotId: string, json: PedroJsonFile): void;
  startPath(robotId: string): void;
  humanPlayerLoad(alliance: Alliance): void;
  getReplayJson(): string;
  on(event: SimulationEvent, handler: Handler): void;
}
```

## MatchDirectorState

```typescript
interface MatchDirectorState {
  running: boolean;
  paused: boolean;
  time: number;
  phase: MatchPhase;
  controlSource: 'human' | 'autonomous' | 'agent' | 'none';
  score: number;
  robots: Record<string, {
    truthPose: Pose;
    estimatedPose: Pose;
    velocity: Vector2;
    batteryVoltage: number;
    mechanismState: MechanismState;
  }>;
}
```

## Packages

| Package | Role |
|---------|------|
| `@ftc-sim/game-decode` | Rules JSON + `DecodeRulesEngine` |
| `@ftc-sim/mechanisms` | Intake, shooter, storage FSM |
| `@ftc-sim/input` | Keyboard/gamepad → `RobotCommand` |
| `@ftc-sim/replay` | Match snapshot record/playback |
| `@ftc-sim/analytics` | Cycle/score/strategy metrics |

## Events

| Event | Payload |
|-------|---------|
| `tick` | `TelemetryFrame` |
| `collision` | `CollisionEvent` |
| `pathComplete` | `{ robotId }` |
| `scenarioComplete` | `{ duration }` |
| `reset` | — |

## Export Formats

- **CSV / JSON telemetry** — via `TelemetryRecorder`
- **`.ftcreplay.json`** — full match snapshots via `ReplayRecorder`
- **NPZ** — Python bridge (`apps/python/ftc_sim_bridge.py`)

See also: [DECODE_RULES.md](./DECODE_RULES.md), [MANUAL_TEST_CHECKLIST.md](./MANUAL_TEST_CHECKLIST.md)
