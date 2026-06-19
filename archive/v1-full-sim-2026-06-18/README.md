# FTC Neural Path Planning Simulator

Physics-first 2D FTC DECODE simulator with Pedro Pathing integration, designed for path execution testing and future neural-network training data collection.

## Features

- **Rapier2D** rigid-body physics (walls, game pieces, robot collisions)
- **Pedro Pathing** coordinate system, PedroJSON import/export, follower port (PIDF + 4 vectors)
- **DECODE field** from data-driven JSON (zones, goals, classifiers, obelisk, artifacts)
- **Pluggable drivetrains**: mecanum, omni-X, kiwi, swerve
- **Sensor simulation**: encoders (noise/slip), IMU (drift), distance (raycast)
- **Telemetry**: CSV/JSON export, Panels-compatible replay adapter
- **Web GUI**: PixiJS field renderer, path overlay, sim controls
- **Headless CLI** + **Python bridge** for batch ML dataset generation (NPZ)

## Quick Start

```bash
pnpm install
pnpm build
pnpm dev          # Web GUI at http://localhost:5190 (see terminal if port differs)
pnpm cli          # Headless episode
```

### CLI

```bash
node apps/cli/dist/index.js --episodes 5 --duration 15 --seed 42 --output ./output
```

### Python Batch + NPZ

```bash
pip install -r apps/python/requirements.txt
python apps/python/ftc_sim_bridge.py batch --episodes 10 --npz --output ./datasets
```

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `@ftc-sim/core` | SimulationEngine orchestration |
| `@ftc-sim/physics` | Rapier2D wrapper |
| `@ftc-sim/field` | Coordinates, field loader |
| `@ftc-sim/season-decode` | DECODE field JSON |
| `@ftc-sim/robot` | Drivetrains, battery model |
| `@ftc-sim/pedro` | Paths, follower, PedroJSON |
| `@ftc-sim/sensors` | Encoders, IMU, distance, localizers |
| `@ftc-sim/telemetry` | Recorder, CSV/JSON export |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full design.

## Coordinate System

Internal canonical coordinates: **Pedro** (0–144 inches, bottom-left origin, CCW heading). See [docs/COORDINATES.md](docs/COORDINATES.md).

## License

BSD-3-Clause (aligned with Pedro Pathing ecosystem)
