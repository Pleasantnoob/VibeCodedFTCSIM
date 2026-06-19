# FTC Neural Path Planning Simulator — Architecture

## Overview

A 2D physics-first FTC simulator for path execution testing, telemetry collection, and future neural-network training. Built as a TypeScript monorepo with a headless core, Pedro Pathing compatibility, and a web GUI.

## Package Graph

```
apps/web ──┐
apps/cli ──┼── @ftc-sim/core (MatchDirector)
           │       ├── @ftc-sim/game-decode (rules engine)
           │       ├── @ftc-sim/mechanisms (intake/shooter)
           │       ├── @ftc-sim/input (keyboard/gamepad)
           │       ├── @ftc-sim/replay
           │       ├── @ftc-sim/analytics
           │       ├── @ftc-sim/physics (Rapier2D)
           │       ├── @ftc-sim/field
           │       │       └── @ftc-sim/season-decode
           │       ├── @ftc-sim/robot
           │       ├── @ftc-sim/pedro
           │       ├── @ftc-sim/sensors
           │       └── @ftc-sim/telemetry
apps/python (Phase 2) ── IPC to core
```

## Simulation Loop (v2)

Each fixed timestep (default 1/120 s):

1. `MatchDirector` advances match phase clock (AUTO → transition → TELEOP)
2. Control source resolves wheel powers (human input OR Pedro follower)
3. `MechanismSystem` updates intake/shooter/gate
4. `Robot.drivetrain.applyPowers()` — motor-matrix mecanum + slip model
5. `PhysicsWorld.step()` — Rapier2D integration and collision
6. `DecodeRulesEngine` evaluates scoring events from physics state
7. `Sensors.read()` → `Localizer.update()` → follower closed loop
8. `TelemetryRecorder` + `ReplayRecorder` + `AnalyticsEngine` record frame

## Design Principles

- **Modularity**: Season logic in JSON; core never hardcodes DECODE
- **Sim-to-real**: Follower uses localizer estimate, not ground truth
- **Determinism**: Seeded RNG, fixed timestep, Rapier deterministic mode
- **Pedro parity**: Coordinates, paths, and follower constants map 1:1 to Pedro Pathing
- **Panels alignment**: Renderer uses Pedro canvas preset for overlay compatibility

## Phase Boundaries

| Phase | Scope |
|-------|-------|
| 1a | Walls, mecanum robot, PedroJSON overlay, basic GUI |
| 1b | Follower port, sensors, path execution |
| 1c | All drivetrains, full field, telemetry export, CLI |
| 2 | Python bindings, batch runner, NPZ export (no NN code) |
| 3 | Java OpMode bridge, vision simulation (future) |

## Data Flow

See `API.md` for interface definitions. Path execution: User → GUI → PedroFollower → Robot → Physics → Localizer → Follower → Telemetry.
