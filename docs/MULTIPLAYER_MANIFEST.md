# FTC Sim Multiplayer Manifest

**Version:** 0.2  
**Status:** Solo sim feature-complete · Practice 2v2 prep **done** · LAN multiplayer **Phase 0–4 done** · Internet port-forward **Phase 5 in progress** · Multi-robot drivers **Phase 7 in progress**  
**Last updated:** 2026-06-19  

This document is the authoritative plan for adding **Minecraft-style multiplayer** to the FTC DECODE simulator: downloadable client, connect by IP, free self-host, internet play without hosting a public website, controller support, and good latency — **without modifying core simulation logic** (collisions, Rapier artifacts, SAT barriers, scoring).

**Before reading §7–11:** skim [**§1.5 Solo sim baseline**](#15-solo-sim-baseline-implemented) (what exists today) and [**§1.6 Practice 2v2 prep**](#16-practice-2v2-prep-in-progress) (current active work).

Related docs: [`ROADMAP.md`](./ROADMAP.md) (single-player phases — partially stale), [`archive/v1-full-sim-2026-06-18/docs/ARCHITECTURE.md`](../archive/v1-full-sim-2026-06-18/docs/ARCHITECTURE.md) (v1 orchestrator reference).

---

## Table of contents

1. [Goals & non-goals](#1-goals--non-goals)
2. [Solo sim baseline (implemented)](#15-solo-sim-baseline-implemented)
3. [Practice 2v2 prep (in progress)](#16-practice-2v2-prep-in-progress)
4. [User-facing model](#2-user-facing-model)
5. [Architecture overview](#3-architecture-overview)
6. [Core sim protection policy](#4-core-sim-protection-policy)
7. [New packages & file layout](#5-new-packages--file-layout)
8. [Session modes](#6-session-modes)
9. [Subsystem reference — server vs client](#7-subsystem-reference--server-vs-client)
10. [Wire protocol](#8-wire-protocol)
11. [Desktop launcher & distribution](#9-desktop-launcher--distribution)
12. [Internet connectivity (playit.gg)](#10-internet-connectivity-playitgg)
13. [Implementation phases](#11-implementation-phases)
14. [Testing & regression strategy](#12-testing--regression-strategy)
15. [Risks, bugs & obstacles](#13-risks-bugs--obstacles)
16. [Open decisions](#14-open-decisions)

---

## 1. Goals & non-goals

### Goals

| Requirement | How we satisfy it |
|-------------|-------------------|
| Good latency | Authoritative sim on host PC; client prediction for own robot; 20–30 Hz snapshots |
| Play with anyone on the internet | playit.gg TCP tunnel (free) or manual port forward; share `host:port` |
| Host from your PC | Match server runs locally; optional tunnel agent |
| Free | No paid VPS or website hosting; GitHub Releases for downloads |
| Controller support | Gamepad read locally in browser; server receives input frames only |
| Easy | One download → Host or Join → paste address |
| Do not break solo sim | Parallel net layer; `sessionMode === 'solo'` uses today’s code path verbatim |

### Non-goals (v1)

- Ranked matchmaking or public server browser
- Encrypted/WSS as a hard requirement (friends-only v1)
- Full 4-robot 2v2 on day one (phased; see §11)
- Integrating with official FTC Live / Scorekeeper APIs
- Client-side authoritative Rapier (causes desync)
- Modifying core packages for net convenience

---

## 1.5 Solo sim baseline (implemented)

The solo practice sim is the **foundation** net multiplayer will wrap. As of 2026-06-19, the following is shipped and tested in `apps/web` + `packages/*`.

### Match clock & FTC Live presentation

| Feature | Location |
|---------|----------|
| Phase machine: `setup` → `init` → `auto` (30s) → `transition` (8s) → `teleop` (120s) → `post` | `packages/match/src/match-clock.ts` |
| Infinite practice teleop, pause/resume, early end | `match-clock.ts`, `apps/web/src/match/useMatchClock.ts` |
| Drive gated to teleop (`allowsDrive`) | `MatchClock.snapshot()` |
| FTC Live phase audio (charge, end-auto+warning, 3-2-1, firebell, whistle, **endmatch**) | `apps/web/src/match/useMatchAudio.ts` |
| Broadcast scoreboard overlay (timer, teams, motif, per-alliance scores) | `apps/web/src/match/MatchFieldOverlay.tsx` |
| End-match ceremony: 3s delay → win/tie **reveal video** (50% vol) → results sting + scoreboard | `MatchResultsCeremony.tsx`, `match-results-assets.ts` |
| NaN-safe tie detection on results screen | `match-results-assets.ts` `resolveMatchOutcome` |

### Mechanisms & artifact physics

| Feature | Location |
|---------|----------|
| Intake (front-edge, 3 slots, line pickup with collision bypass while intake on) | `packages/mechanisms/src/artifact-simulation.ts` |
| **Parked artifact bodies** — no ghost colliders after pickup | `packages/physics/src/physics-world.ts` `parkArtifactBody` / `activateArtifactBody` |
| Shoot (launch zone, trajectory flight, basin scoring, hold-fire 5 Hz) | `artifact-simulation.ts`, `geometry.ts` |
| **Gate auto-release** on robot footprint entering gate zone (edge-triggered) | `artifact-simulation.ts` `checkAutoGates`, `robotInGateZone` (OBB overlap) |
| Gate debug overlay (footprint polygon + teal zones) | `FieldCanvas.tsx` |
| AUTO artifact collision bypass (robot passes through field balls) | `shouldBypassRobotArtifactCollision` |
| Ramp / overflow / human-player respawn / stuck recovery | `artifact-simulation.ts` |
| DECODE rules, fouls, multi-robot parking scoring hooks | `packages/game-decode/src/rules-engine.ts` |
| Mechanism debug log panel | `App.tsx`, `mechanism-log.ts` |

### Pedro autonomous

| Feature | Location |
|---------|----------|
| Multi-segment paths + **wait steps** (`durationMs`, shoot during waits) | `packages/pedro/src/auto-sequence.ts` |
| Visualizer `.pp` parse (`sequence[]`, per-line `waitBeforeMs` / `waitAfterMs`) | `packages/pedro/src/pp-io.ts` |
| Segment handoff without drift (immediate next segment at 2.5″ threshold) | `auto-sequence.ts`, `follower.ts` |
| Alliance mirroring | `packages/pedro/src/mirror-path.ts` |
| Bundled example | `apps/web/public/examples/decode-auto.pp` |
| Human takeover during auto → teleop + follower cancel | `App.tsx`, `usePhysicsRobot.ts` |

### Physics & drive

| Feature | Location |
|---------|----------|
| 120 Hz fixed timestep, max 4 steps/frame | `apps/web/src/robot/game-loop.ts` |
| Velocity holonomic drive + SAT goal barriers | `packages/robot/src/velocity-drive.ts`, `barrier-collision.ts` |
| Single Rapier **kinematic** player robot + dynamic artifact circles | `artifact-world.ts`, `physics-world.ts` |
| Editable goal barriers (sync without full world reset) | `artifact-world.ts` `syncBarriers` |
| Robot config sliders (speed, mass, footprint, etc.) | `App.tsx` |

### Web app (solo)

- WASD + gamepad field-centric teleop; intake (F/LT), shoot hold (Space/RT)
- Path upload (`.json` / `.pp`), follower HUD, barrier/zone editor
- Match controls: INIT, START AUTO, TELEOP, INF, PAUSE, END MATCH, RESET
- `__ftcSim` dev inject API (`apps/web/src/dev/inject-drive.ts`)
- **Not yet:** telemetry replay export, E2E suite (UI marks upcoming)

**Net implication:** `SimSession` extraction (Phase 1) must preserve the tick order and APIs above verbatim.

---

## 1.6 Practice 2v2 prep (in progress)

Before LAN/WebSocket multiplayer, we are building a **local 4-robot practice field** so scoring, fouls, and parking rules match a real 2v2 match. This is **not** net multiplayer — it is single-player sim with static/dynamic alliance partners and opponents.

### Implemented today

| Feature | Location | Behavior |
|---------|----------|----------|
| Practice robot layouts (3 NPCs + player) | `apps/web/src/robot/match-robots.ts` | `blue-near`, `red-near` (BASE), `red-far` (BASE) |
| Player spawn | `BLUE_FAR_SPAWN` | Blue far-side human-player corner |
| Render extra robots on field | `App.tsx` → `FieldCanvas` `extraRobots` | CSS `field-robot--npc` |
| **Kinematic SAT blocking** (player pushed off static NPC OBBs) | `npcObstaclePolygons` → `stepVelocityDrive({ robotObstacles })` | `packages/robot/src/barrier-collision.ts` `resolveRobotObstacleCollisions` |
| 4-robot snapshots for rules | `matchRobotSnapshots` | Passed each tick to `ArtifactWorld` / rules |
| Endgame parking for all robots | `rules-engine.ts` `evaluateMatchParking` | NPCs parked in BASE affect alliance bonus |
| Opponent contact fouls (all pairs) | `rules-engine.ts` `tickContactRules` | Uses all robot footprints in teleop |

### In progress (active work)

| Gap | Target | Notes |
|-----|--------|-------|
| **Dynamic other-robot Rapier bodies** | One kinematic body per practice robot | Today only `ROBOT_BODY_ID` exists in Rapier |
| **Robot–robot collision via physics** | Mutual push, not just player SAT vs static polygons | NPCs are fixed poses; no `syncKinematicRobot` for allies/opponents |
| **Artifact collision with NPC robots** | Balls bounce off all robot bodies | Only player body toggles `setRobotArtifactCollision` |
| **Driven alliance partner / opponent** | Optional AI or scripted motion later | Prerequisite for net sync in Phase 7 |

### Exit criteria (Practice 2v2 prep)

- [x] 4 kinematic robot bodies in Rapier (player + 3 NPCs), synced each tick
- [x] Player + NPCs participate in artifact collision groups correctly
- [x] Robot–robot resolution consistent (no tunneling, no ghost bodies)
- [x] Solo regression suite still green; frozen-file policy respected
- [x] Documented snapshot shape for future `StateSnapshot.robots[]` (4 entries)

**Then** proceed to Phase 0 guardrails + `packages/session` extraction for net multiplayer.

---

## 2. User-facing model

### What players download

A single **FTC Sim** desktop bundle (Windows first):

```
FTC-Sim/
  FTC-Sim.exe              # Launcher
  resources/web/           # Built React app (apps/web/dist)
  resources/match-server/  # Bundled Node server binary
  README.txt
```

No Node, pnpm, or dev tools required for friends.

### Three modes in the launcher

| Mode | Who runs sim | Who connects where |
|------|--------------|-------------------|
| **Play Solo** | Local browser | Nothing (current app) |
| **Host Match** | Host PC match-server | Friends connect to host `:5191` |
| **Join Match** | Host PC (remote) | Client UI at `localhost:5190` → WebSocket to entered address |

### Join flow (friend)

1. Download zip / run `FTC-Sim.exe`
2. Choose **Join Match**
3. Enter `192.168.1.50:5191` (LAN) or `xyz.playit.gg:12345` (internet)
4. Pick display name + robot slot (when multi-robot exists)
5. Press a gamepad button to activate pad (browser requirement)
6. Play

### Host flow (you)

1. Choose **Host Match**
2. Server starts on `0.0.0.0:5191`
3. UI shows LAN address + optional playit tunnel address (copy button)
4. Share address with friends
5. Use referee buttons (INIT, START AUTO, TELEOP, RESET) — host-only in v1

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Host PC (authoritative)                          │
│  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────────┐  │
│  │ match-server │───►│ packages/session  │───►│ EXISTING (unchanged) │  │
│  │  WS :5191    │    │ SimSession.tick() │    │ MatchClock           │  │
│  └──────▲───────┘    └─────────────────┘    │ stepVelocityDrive    │  │
│         │ playit optional                    │ ArtifactWorld        │  │
│  ┌──────┴───────┐                            │ DecodeRulesEngine    │  │
│  │ Host browser │  (Host may also be a WS client to localhost)      │  │
│  │ localhost    │                            └──────────────────────┘  │
└─────────┼───────────────────────────────────────────────────────────────┘
          │ WebSocket (JSON v1, TCP)
          │
┌─────────┼───────────────────────────────────────────────────────────────┐
│         ▼              Join client PC                                    │
│  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────────┐  │
│  │ SessionClient│───►│ Render layer    │    │ NO authoritative     │  │
│  │ (packages/net)│   │ FieldCanvas     │    │ ArtifactWorld.tick   │  │
│  └──────▲───────┘    │ MatchOverlay    │    │ (display + predict)  │  │
│         │            └─────────────────┘    └──────────────────────┘  │
│  ┌──────┴───────┐                                                       │
│  │ Gamepad/WASD │  drive-input-sampler (local only)                    │
│  └──────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tick authority rule

**Only the host `SimSession` advances simulation time.** Join clients never call `ArtifactWorld.tick()` or `stepVelocityDrive()` for authoritative state. They may run **prediction** for the locally owned robot only (Phase 6), then reconcile on snapshot.

---

## 4. Core sim protection policy

### 4.1 DO NOT MODIFY (frozen contracts)

These files must not change during multiplayer work. Net code wraps them; it does not fork logic.

| Package / file | Responsibility |
|----------------|----------------|
| `packages/robot/src/velocity-drive.ts` | Kinematic robot integration |
| `packages/robot/src/barrier-collision.ts` | SAT barrier resolution |
| `packages/robot/src/obb-sat.ts` | OBB geometry |
| `packages/robot/src/kinematic.ts` | Field edge clamping |
| `packages/mechanisms/src/artifact-simulation.ts` | Mechanism FSM + tick order |
| `packages/mechanisms/src/geometry.ts` | Shot arcs, zone tests, gate OBB overlap |
| `packages/physics/src/physics-world.ts` | Rapier step, friction, clamps, `parkArtifactBody` |
| `packages/game-decode/src/rules-engine.ts` | Scoring state machine |
| `packages/match/src/match-clock.ts` | Phase machine semantics |
| `apps/web/src/robot/game-loop.ts` | `PHYSICS_DT`, max steps per frame |

### 4.2 Caution zone

| File | Allowed change |
|------|----------------|
| `apps/web/src/artifacts/artifact-world.ts` | Move to `packages/session`; **no tick order changes** |
| `apps/web/src/robot/usePhysicsRobot.ts` | Delegate to `SimSession` when provided; **same step order**; practice NPC obstacles via `robotObstacles` |
| `apps/web/src/robot/match-robots.ts` | Practice layouts only until multi-body Rapier lands |
| `apps/web/src/App.tsx` | Mode switch + lobby UI; solo branch untouched |

### 4.3 Solo preservation rule

```typescript
if (sessionMode === 'solo') {
  // Exact current code path — no SessionClient, no remote snapshots
}
```

Every multiplayer PR must pass all existing Vitest suites with **zero changes** to frozen files.

---

## 5. New packages & file layout

```
packages/
  session/                 # Headless SimSession (extracted loop)
    src/
      sim-session.ts       # tick(dt, inputs) → StateSnapshot
      sim-session.test.ts
      determinism.test.ts
      index.ts

  net/                     # Wire types + client/server helpers (no sim logic)
    src/
      protocol.ts          # Message types, version constants
      codec.ts             # JSON encode/decode, validation
      input-buffer.ts      # Latest input per robot per tick
      snapshot-interp.ts   # Client-side interpolation helpers
      index.ts

apps/
  match-server/            # Node WebSocket host
    src/
      server.ts            # WS server, room, broadcast
      room.ts              # One match room state
      host-loop.ts         # 120 Hz setInterval / setImmediate loop
      index.ts

  desktop/                 # Electron launcher (Phase 4)
    src/
      main.ts              # Spawn server, serve dist, open browser
    resources/

apps/web/src/
  session/                 # React integration only
    SessionProvider.tsx
    useSessionClient.ts
    LobbyScreen.tsx
    HostPanel.tsx
    session-mode.ts        # 'solo' | 'host' | 'join'
```

**Dependency rule:** `packages/session` may depend on existing sim packages. **`packages/net` must not import React or Rapier directly** — only types and codecs.

---

## 6. Session modes

| Mode | `SimSession` location | WebSocket | Input source | Rendering source |
|------|----------------------|-----------|--------------|------------------|
| `solo` | Browser (`usePhysicsRobot`) | None | Local sampler | Local sim state |
| `host` | `match-server` on host PC | Server listens `:5191` | Local + remote inputs | Server snapshots (host UI is a client to localhost) |
| `join` | Remote host only | Client connects out | Local sampler → network | Remote snapshots (+ prediction) |

**Recommended v1 host UI pattern:** Host browser connects to `ws://127.0.0.1:5191` like any other client, with `role: 'host'` for referee commands. Avoids duplicating sim in browser and server.

---

## 7. Subsystem reference — server vs client

For each subsystem: **what runs where**, **what is sent on the wire**, and **how solo mode stays unchanged**.

---

### 7.1 Game loop & fixed timestep

| | Solo | Server (host) | Client (join) |
|---|------|---------------|---------------|
| **Runs loop?** | Yes — `usePhysicsRobot` rAF | Yes — `host-loop.ts` at 120 Hz | No authoritative loop |
| **Module** | `game-loop.ts` | Same `advanceAccumulator` logic, wall-clock driven | N/A |
| **dt** | `1/120` s | `1/120` s fixed | N/A |
| **Max steps/frame** | 4 | Uncapped per tick interval (server uses dedicated timer) | N/A |

**Server implementation:**

- Use `setInterval` or high-resolution loop targeting 120 Hz.
- If server falls behind, cap catch-up steps (e.g. max 8) and log warning — do not spiral.
- Expose `tickIndex: number` monotonic counter on every snapshot.

**Client implementation:**

- rAF drives **render only** (interpolation between snapshots).
- Optional: run prediction step at display rate for owned robot only (Phase 6).

**Solo unchanged:** `usePhysicsRobot` keeps existing rAF + `advanceAccumulator`.

**Bug watch:** Server using wall-clock `dt` vs fixed `1/120` — always pass fixed dt into `SimSession.tick(1/120)`.

---

### 7.2 Match clock (`MatchClock`)

| | Solo | Server | Client |
|---|------|--------|--------|
| **Authority** | Local `MatchClock` | Host `MatchClock` inside `SimSession` | Display copy from snapshots |
| **Tick** | `onPhysicsStepRef` each physics step | Same — once per sim step | Never tick locally |
| **Phase buttons** | Local `useMatchClock` | Host client sends `host_cmd` | Hidden/disabled unless `role: referee` |

**Server:**

- Owns single `MatchClock` instance.
- Calls `clock.tick(dt)` inside sim loop (step ① today).
- Phase transitions (`initMatch`, `startAuto`, `startTeleop`, `reset`) only via `host_cmd` messages from host role.
- Auto phase transitions (auto → transition → teleop) happen inside `MatchClock.tick` — server-only.
- Include full `MatchSnapshot` in every broadcast.

**Client:**

- `useMatchClock` **not used for authority** in join mode.
- React state updated from `snapshot.match` at receive rate (~20–30 Hz).
- Overlay timer may jitter ±50 ms — acceptable for FTC practice.
- `allowsDrive` from server snapshot gates whether local input is sent (not whether local sim runs).

**Solo unchanged:** `useMatchClock` + `onPhysicsStepRef` wiring in `App.tsx` as today.

**Bug watch:**

- Client pressing INIT locally must not call local clock in join mode.
- `infiniteMode` practice: host-only command in v1.
- Auto → teleop takeover on human input (`hasActiveDriveInput`): server must detect **remote** human input during auto and call `startTeleop()` + cancel Pedro for that robot.

---

### 7.3 Drive input & control source

| | Solo | Server | Client |
|---|------|--------|--------|
| **Read keyboard/gamepad** | `drive-input-sampler` | No — receives `InputFrame` | Yes — local sampler |
| **Resolve auto vs human** | `resolveDriveInput` in hook | Same function in `SimSession` | N/A (server resolves) |
| **Inject path** | `injectInput` / `__ftcSim` | Input buffer → inject equivalent | Send `InputFrame` over WS |

**Server:**

- Maintain `InputBuffer`: `Map<robotId, LatestInput>` updated on each WS message.
- At tick N, consume buffered input for each robot (same sample reused if no new packet — mirrors solo’s once-per-frame sample across multi-step frames initially; refine to per-tick buffer in Phase 6).
- Run `resolveDriveInput(sample, null, allowsDrive, controlSource, phase, …)` per robot.
- Set `controlSource` from `MatchClock`, not from client claims.

**Client:**

- `useDriveInput` + sampler run normally.
- At 60 Hz (or each rAF), if connected and slot assigned, emit:

```typescript
{
  type: 'input',
  seq: number,
  robotId: 'blue-1',
  drive: { forward, strafe, turn, brake? },
  mechanism: { intake?, shoot? },
  shootEdge: boolean,
}
```

- Do **not** call `stepVelocityDrive` locally in join mode (except prediction overlay).
- If disconnected: stop sending; show lobby error.

**Solo unchanged:** No `SessionClient`; sampler → hook directly.

**Bug watch:**

- Edge flags (`shootEdge`) must be computed client-side (rising edge) and sent once — server applies once per tick. (`gateEdge` not used — gates are proximity on server.)
- Gamepad smoothing (`INPUT_SMOOTH`) stays client-side — server receives already-smoothed values.
- Duplicate inputs due to TCP: idempotent via `seq`; server uses latest.

---

### 7.4 Robot kinematics & barrier collision (SAT)

| | Solo | Server | Client |
|---|------|--------|--------|
| **Authority** | Local `stepVelocityDrive` | Server `stepVelocityDrive` | Snapshot + optional prediction |
| **Packages** | `@ftc-sim/robot` | Same | Display only |
| **Practice NPCs** | Static SAT `robotObstacles` (Phase 0.5 → Rapier bodies) | 4 bodies | Snapshot poses |

**Solo (current):**

- Player: `stepVelocityDrive` with SAT goal barriers + `robotObstacles` from `npcObstaclePolygons()` (fixed NPC poses).
- One Rapier kinematic player body; NPCs are render + SAT only until Phase 0.5.

**Server:**

- For each robot each tick: call `stepVelocityDrive` with resolved input, barriers from room config, footprint from robot config.
- Barriers: host’s editable barrier set serialized at room create; frozen for match duration unless host resets.

**Client:**

- Render robot pose from `snapshot.robots[]`.
- Interpolate between last two snapshots for other robots (~100 ms buffer).
- **Owned robot (Phase 6):** apply local `stepVelocityDrive` prediction; on snapshot, blend toward authoritative pose if error > threshold (e.g. 2 in).

**Solo unchanged:** Full local `stepVelocityDrive` path in `usePhysicsRobot`.

**Bug watch:**

- Client prediction must use **same** barriers as server or correction jumps — send `barrierHash` in room config.
- Never edit `velocity-drive.ts` or `barrier-collision.ts` for net fixes.

---

### 7.5 Pedro path follower (AUTO)

| | Solo | Server | Client |
|---|------|--------|--------|
| **Follower instance** | `AutoSequenceRunner` in App (`followerRef`) | Per-robot runner in `SimSession` | None (server runs auto) |
| **Path data** | Loaded in App (`.pp` / `.json`) | Host uploads path in lobby OR host-only pre-load v1 | N/A |

**Solo (current):**

- `AutoSequenceRunner` chains path segments + **wait steps**; `shouldAutoShoot()` true during waits.
- `PedroFollower` per segment; handoff at `PEDRO_SEGMENT_END_THRESHOLD` (2.5″).
- Intake forced on during auto; shoot hold when runner requests.
- Human input during auto → `startTeleop()` + follower reset (`App.tsx` `onSimHudTick`).

**Server:**

- During `controlSource === 'autonomous'` and phase auto/transition, run `AutoSequenceRunner` identically to solo.
- Path chain loaded when host assigns auto path to robot (v1: host robot only).
- On human input during auto: server calls `follower.reset()` + `clock.startTeleop()` for that alliance policy.
- Port `autoBurstRef` / wait-shoot parity into session layer if still duplicated in hook.

**Client:**

- May display planned path if host broadcasts path polyline (optional, cosmetic).
- Driver cannot steer follower directly in auto — input ignored when `allowsDrive` false except takeover edges handled server-side.

**Solo unchanged:** Existing Pedro wiring in `App.tsx` + `usePhysicsRobot`.

**Bug watch:**

- Follower uses pose/velocity state — must run on server with authoritative pose, not client prediction.
- Multi-robot auto: each robot needs own runner + path — Phase 7 scope.

---

### 7.6 ArtifactWorld, Rapier & artifacts

| | Solo | Server | Client |
|---|------|--------|--------|
| **Rapier world** | Local `ArtifactWorld` | Server `ArtifactWorld` (or multi-world Phase 7) | None |
| **Artifact render** | `getRenderArtifacts()` | Snapshot `mechanisms.artifacts` | Interpolated sprites |

**Server:**

- Full `ArtifactWorld.init`, `tick`, `reset` on host.
- Tick order preserved:

```
applyCommand → sim.tick → (rules, intake, shoot, gates, held, flight, spawns, gate queue, physics.step, sync)
```

- **Held / in-flight / on-ramp artifacts** use `parkArtifactBody` (collider off, body teleported, slept) — no ghost colliders at pickup sites.
- `randomizeMotif()` only on server reset; motif in snapshot.
- `artifactFriction` from host room settings.
- Strip `debugLogs` from network snapshots (keep locally on host if needed).

**Client:**

- Map `SimArtifactState[]` from snapshot to `FieldCanvas` props.
- In-flight artifacts: use `flightElapsed` from server — do not simulate trajectory locally.
- Held artifacts: pose follows robot from snapshot, not local attach logic.

**Solo unchanged:** Local `ArtifactWorld` in `usePhysicsRobot`.

**Bug watch:**

- **Critical:** Join client running local Rapier will desync on collisions — forbidden in v1.
- Rapier WASM async init on server: await before accepting players; send `server_ready` event.
- `settle()` on reset must complete before match start signal.

---

### 7.7 Mechanisms (intake, shoot, gate)

| | Solo | Server | Client |
|---|------|--------|--------|
| **Command application** | `artifactWorld.tick` | Same | Input frames only |
| **Edge detection** | Sampler `shootEdge` (gate edge unused — proximity gates) | Server applies shoot edges once | Client detects shoot edges |

**Solo (current):**

- **Intake:** front-edge pickup; while intake on + storage room, robot bypasses artifact collision (line intake).
- **Gate:** **proximity auto-release** when robot OBB enters gate zone (`checkAutoGates` edge trigger). No B-button requirement.
- **Shoot:** launch-zone eligibility; hold-fire during teleop; auto shoot during wait steps via `AutoSequenceRunner`.
- `gateEdge` in sampler is legacy/unused — do not require it on wire protocol v1.

**Server:**

- Applies `MechanismCommand` + shoot edges from input buffer.
- Auto wait-shoot logic must mirror `AutoSequenceRunner.shouldAutoShoot()` in session layer.

**Client:**

- Show mechanism debug HUD from snapshot flags (`intakeActive`, `stored[]`) — not from local sim.
- Audio cues (shoot, score) triggered on snapshot diff (e.g. score increased) — see §7.10.

**Solo unchanged:** Existing mechanism path in hook.

**Bug watch:**

- Gate proximity uses same `robotInGateZone` OBB test as debug overlay — server must use identical geometry.
- Holding shoot in auto schedules via runner waits — replicate in session layer.

---

### 7.8 Scoring & rules engine (`DecodeRulesEngine`)

| | Solo | Server | Client |
|---|------|--------|--------|
| **Authority** | Local rules inside `ArtifactWorld` | Server only | Display `MatchState` |
| **Obelisk motif** | Client `randomizeMotif` today | Server seed on reset | From snapshot |

**Server:**

- `rules.syncPhase` driven by sim tick inside `ArtifactSimulation` — unchanged.
- Full `MatchState` (scores, ramp, gates, events) in snapshot.
- Score events: optionally send `score_event` delta messages for overlay animations.

**Client:**

- `MatchFieldOverlay` reads `matchGameState` from snapshot provider.
- Event log: append from snapshot `events` diff.

**Solo unchanged:** Local `getMatchState()`.

**Bug watch:**

- `simTime` vs match clock — scoring uses sim time inside mechanisms; server must tick mechanisms at same rate as solo (120 Hz).

---

### 7.9 Field, barriers & zones

| | Solo | Server | Client |
|---|------|--------|--------|
| **Field definition** | `getDecodeField()` | Same static data | Same static data (bundled) |
| **Editable barriers** | Local React state | Host config at room create | Receive `barrierConfig` on join |
| **Zones overlay** | Local toggles | Cosmetic only | Local toggles (no sim effect) |

**Server:**

- On `host_cmd: create_room`, serialize barriers to JSON; compute hash.
- All clients must match hash before sim starts.

**Client:**

- Apply received barriers to render SAT outlines and display.
- Editor disabled in join mode.

**Solo unchanged:** Local barrier editor.

---

### 7.10 Match overlay & audio (FTC Live)

| | Solo | Server | Client |
|---|------|--------|--------|
| **Team numbers** | Local overlay state | Host sets; broadcast in `room_info` | Display |
| **Timer** | Local clock snapshot | Server snapshot | Server snapshot |
| **Audio** | `useMatchAudio` local | Host plays OR all clients play on phase diff | Play on snapshot phase change |
| **Results ceremony** | `MatchResultsCeremony` local | Host-only or all clients on `post` | Snapshot-triggered |

**Solo (current):**

- Phase audio: charge (auto start), end-auto+warning, 3-2-1 (transition), firebell (teleop), whistle (T-20), **endmatch** (teleop→post).
- `MatchResultsCeremony`: 3s delay → win/tie video (`MATCH_REVEAL_VIDEO_VOLUME = 0.5`) → `results.wav` + `MatchResultsOverlay`.
- `resolveMatchOutcome` treats NaN totals as 0 (tie when both invalid).

**Server:**

- Broadcast `overlayRedTeams`, `overlayBlueTeams`, event name in room metadata.

**Client:**

- `useMatchAudio`: trigger sounds when `snapshot.match.phase` transitions (same cues as solo).
- Ceremony on `post` phase; avoid double-play on host if host-only audio in v1.

**Solo unchanged:** Current overlay + audio + ceremony hooks.

**Bug watch:**

- Phase transition audio lagging 50–100 ms behind due to snapshot rate — acceptable.
- Ceremony video/audio must not race with `endmatch` sting — solo plays endmatch at post entry, ceremony after delay.

---

### 7.11 Rendering (`FieldCanvas`)

| | Solo | Server | Client |
|---|------|--------|--------|
| **Pose source** | Local refs | N/A (headless) | Snapshot interpolation |
| **Planned path** | Local Pedro chain | Optional broadcast | Optional display |
| **Debug zones** | Local toggle | N/A | Local toggle |

**Server:** No rendering.

**Client:** Single render path fed by `RenderState` interface:

```typescript
interface RenderState {
  robots: { id: string; pose: Pose; alliance: Alliance }[];
  artifacts: SimArtifactState[];
  match: MatchSnapshot;
  score: MatchState;
}
```

Solo implements `RenderState` from local hook; join from `SessionClient`.

**Solo unchanged:** Direct props from `usePhysicsRobot` — refactor to adapter only if zero behavior change.

---

### 7.12 Telemetry & dev API

| | Solo | Server | Client |
|---|------|--------|--------|
| **`__ftcSim`** | Full inject API | Disabled or host-only | Disabled |
| **Telemetry buffer** | Local 600 frames | Server-side log optional | Last N snapshots |

**Solo unchanged:** `inject-drive.ts` works in solo mode only.

---

### 7.16 Practice 2v2 robots (solo prep → multiplayer foundation)

| | Solo (today) | Server (future) | Client (future) |
|---|--------------|-----------------|-----------------|
| **Robot count** | 4 (1 player + 3 NPC) | 4 authoritative | 4 rendered from snapshot |
| **Physics** | 1 Rapier body + 3 static SAT obstacles | 4 Rapier kinematic bodies | Display + predict own |
| **Rules** | All 4 in `matchRobotSnapshots` | Same snapshots from server | Display only |

**Current solo behavior:**

- `practiceFieldRobots()` places NPCs; `FieldCanvas` renders them.
- Player drive uses `robotObstacles` SAT push-out against **fixed** NPC footprints.
- Scoring/fouls/parking already iterate all four robots.

**In progress:**

- Add Rapier kinematic body per robot ID (not only `ROBOT_BODY_ID`).
- `syncKinematicRobot` for each body each tick; artifact collision with all robot colliders.
- Mutual robot–robot resolution (replace or augment one-sided SAT obstacles).

**Multiplayer mapping:**

- NPC poses become **remote player snapshots** in Phase 7.
- Practice prep validates `StateSnapshot.robots[]` with 4 entries before any WebSocket work.

**Bug watch:**

- Do not fork `velocity-drive.ts` for NPCs — extend `ArtifactWorld` / session to register N robot bodies.
- Static SAT obstacles must be removed once dynamic bodies are stable (avoid double collision).

---

### 7.13 WebSocket server (`apps/match-server`)

**Responsibilities:**

- Listen `0.0.0.0:5191`
- One room per process (v1)
- Client lifecycle: connect → `hello` → `welcome` (playerId, robotId, role) → streaming
- Rate limit input messages (max ~120/s per client)
- Drop slow clients (optional kick if input queue stale > 500 ms)
- Broadcast snapshots at 20–30 Hz (decouple from 120 Hz sim loop)
- On host disconnect: send `match_ended` + close room

**Not responsible for:**

- HTTP static files (desktop launcher serves UI)
- TLS termination (playit/raw TCP v1)
- Anti-cheat

---

### 7.14 Session client (`packages/net` + `useSessionClient`)

**Responsibilities:**

- Connect / reconnect with backoff
- Send input frames
- Receive snapshots → update React context
- Ping/pong RTT display in lobby HUD
- Version check on `welcome`

**Not responsible for:**

- Running sim
- Phase buttons (except forwarding `host_cmd` if role is host)

---

### 7.15 Desktop launcher (`apps/desktop`)

**Responsibilities:**

- Serve `resources/web/` at `http://127.0.0.1:5190` (never LAN IP — gamepad secure context)
- Open sim in an **Electron game window** (localhost secure context; gamepad works)
- **Host:** spawn match-server child process; optionally spawn playit agent if configured
- **Join:** spawn UI only
- Copy address to clipboard
- Windows firewall: optional first-run prompt to allow port 5191

**Not responsible for:**

- Sim logic
- Updating game (manual download v1; auto-updater Phase 8+)

---

## 8. Wire protocol

### 8.1 Constants

```typescript
export const SIM_NET_PROTOCOL_VERSION = 1;
export const DEFAULT_MATCH_PORT = 5191;
export const DEFAULT_UI_PORT = 5190;
export const SERVER_TICK_HZ = 120;
export const SNAPSHOT_HZ = 25;
```

### 8.2 Message catalog

#### Client → Server

| Type | Payload | When |
|------|---------|------|
| `hello` | `{ protocol, appVersion, displayName }` | On connect |
| `input` | `InputFrame` | ~60 Hz while driving |
| `host_cmd` | `{ cmd: 'init' \| 'start_auto' \| 'teleop' \| 'reset' \| 'pause' \| 'resume', ... }` | Host role only |
| `claim_slot` | `{ robotId }` | Lobby |
| `ping` | `{ t }` | Optional RTT |

#### Server → Client

| Type | Payload | When |
|------|---------|------|
| `welcome` | `{ playerId, role, robotId?, roomConfig }` | After hello |
| `snapshot` | `StateSnapshot` | ~25 Hz |
| `room_info` | `{ addresses, players[], barrierHash }` | Lobby updates |
| `server_ready` | `{ motif }` | After Rapier init |
| `match_ended` | `{ reason }` | Host left / kick |
| `error` | `{ code, message }` | Version mismatch, room full |
| `pong` | `{ t }` | RTT |

### 8.3 `StateSnapshot` shape

```typescript
interface StateSnapshot {
  type: 'snapshot';
  tick: number;
  match: MatchSnapshot;
  robots: Array<{
    id: string;
    alliance: 'blue' | 'red';
    pose: { x: number; y: number; heading: number };
    linear: { x: number; y: number };
    angular: number;
  }>;
  mechanisms: MechanismSnapshot; // debugLogs stripped
  score: MatchState;
  motif: '21' | '22' | '23';
}
```

### 8.4 Version mismatch

If `hello.protocol !== SIM_NET_PROTOCOL_VERSION`, server sends `error` + close. Client shows: “Update your download from GitHub Releases.”

---

## 9. Desktop launcher & distribution

### 9.1 Build pipeline

```bash
pnpm build                    # apps/web → dist
pnpm --filter @ftc-sim/match-server build
pnpm --filter @ftc-sim/desktop build   # Electron pack
# Output: apps/desktop/release/FTC-Sim-win-x64.zip
```

### 9.2 Electron vs Tauri

| | Electron (v1) | Tauri (v2 slim) |
|---|---------------|-----------------|
| Bundle size | ~120 MB | ~10 MB |
| Spawn Node server | Native | Sidecar via `externalBin` |
| Gamepad on localhost | Works | CSP tuning required |
| Recommendation | **Ship first** | Optimize later |

### 9.3 Distribution (free)

- **GitHub Releases** — primary
- Discord / Google Drive — direct share
- No public website required

### 9.4 Code signing

Unsigned Windows builds trigger SmartScreen. README explains “More info → Run anyway.” Code signing is optional paid upgrade.

---

## 10. Internet connectivity (playit.gg)

### 10.1 Why playit

- Free TCP tunnels — WebSocket compatible
- No port forwarding; works behind CGNAT
- Host-only agent; friends only need game zip + address
- Static public port per tunnel

Reference: [playit.gg](https://playit.gg/), [custom TCP guide](https://blog.gedas.dev/playitgg/)

### 10.2 Host setup

1. Install playit agent (once)
2. Create tunnel: **TCP** → `127.0.0.1:5191`
3. Share allocation address (e.g. `shared.playit.gg:54321`)

### 10.3 Launcher integration (Phase 5)

- Detect playit installed → offer “Enable internet tunnel”
- Show both LAN and playit addresses
- Friends paste playit address in Join screen

### 10.4 Limitations

| Issue | Mitigation |
|-------|------------|
| Extra latency (~20–80 ms) | Client prediction; wired host |
| Free tier bandwidth cap | Small JSON snapshots; 2–4 players |
| Premium for UDP/TCP+UDP | Not needed — WebSocket over TCP |
| Host PC must stay on | Document clearly |

### 10.5 Fallback: port forward

README section for manual router TCP 5191 → host PC. Same Join UI.

---

## 11. Implementation phases

### Phase 0 — Guardrails

- [x] CI runs package tests (`robot`, `mechanisms`, `physics`, `pedro`, `game-decode`, `match`)
- [x] Add `packages/session` with `determinism.test.ts` (golden hash at tick N)
- [ ] Solo manual regression checklist in this doc §12

**Exit:** No changes to frozen files; determinism test green.

**Status (2026-06-19):** `packages/session` + determinism harness merged.

---

### Phase 0.5 — Practice 2v2 (local multi-robot) **✓ complete**

- [x] Practice robot layouts + render (`match-robots.ts`, `FieldCanvas` `extraRobots`)
- [x] Player SAT push-out vs static NPC footprints (`robotObstacles`) — superseded by dynamic bodies
- [x] 4-robot rules snapshots (parking, contact fouls)
- [x] **Dynamic Rapier bodies for all 4 robots**
- [x] **Artifact + robot–robot collision for NPC bodies**
- [x] Remove redundant static SAT obstacles once physics bodies stable

**Exit:** Four kinematic robot bodies in one Rapier world; solo regression green. See §1.6.

---

### Phase 1 — `SimSession` extraction

- [x] Extract tick loop from `usePhysicsRobot` into `SimSession` (`packages/session`)
- [x] Include practice robots + `matchRobotSnapshots` in session API
- [ ] Hook delegates when `simSessionRef` provided; default inline (solo)
- [x] Headless run in Node: determinism test ticks 240 steps

**Exit:** Solo bit-identical on regression tests.

---

### Phase 2 — `match-server` LAN

- [x] WebSocket room, 120 Hz sim, 25 Hz broadcast
- [x] 1 robot, host drives from browser (input over WS)
- [x] Join client render-only (snapshot-driven field)

**Exit:** Two machines on LAN play one match. *(Needs human LAN smoke.)*

---

### Phase 3 — Lobby & mode switch

- [x] `LobbyScreen`, `sessionMode`, connect/disconnect UI
- [x] Host referee commands (via `host_cmd`)
- [x] `solo` path verified untouched

---

### Phase 4 — Desktop launcher

- [x] Electron app (`apps/desktop`) — launcher UI, static UI server, match-server spawn
- [x] `prepare:resources` + `release` scripts (GitHub Release zip)
- [x] README for friends (`apps/desktop/README.txt`)

**Exit:** Non-dev friend joins via zip. *(Built: `apps/desktop/release/FTC-Sim-win-x64.zip` — run `pnpm build:desktop` to rebuild.)*

---

### Phase 5 — Internet (playit)

- [x] Tunnel docs ([`docs/INTERNET_PLAY.md`](./INTERNET_PLAY.md))
- [x] Launcher + in-game lobby show LAN + playit address (save/copy)
- [x] playit install detection (Windows)
- [ ] Test cross-network join (human: cellular friend)

**Exit:** Cellular friend joins home host.

---

### Phase 6 — Latency polish

- [ ] Input buffer per tick
- [ ] Client prediction + reconciliation
- [ ] Interpolation for remote robots/artifacts

**Exit:** Teleop feels good at 100 ms RTT.

---

### Phase 7 — Multi-robot (2v2)

- [x] 4 robot slots in `SimSession` with per-slot input (drive)
- [x] Per-robot input routing on match-server (all claimed slots)
- [x] Slot claim in lobby (`claim_slot` + 4-slot picker UI)
- [ ] Per-robot intake/shoot (mechanisms still on `player` body only)
- [ ] 4 human drivers verified over LAN/internet

**Exit:** 4 human drivers over network.

---

## 12. Testing & regression strategy

### 12.1 Automated (every PR)

| Suite | Path |
|-------|------|
| Robot drive + barriers | `packages/robot/src/*.test.ts` |
| Mechanisms + scoring | `packages/mechanisms`, `packages/game-decode` |
| Match clock | `packages/match` |
| Physics | `packages/physics` |
| Determinism | `packages/session/determinism.test.ts` (planned) |
| Net codec | `packages/net` roundtrip (planned) |
| Match results / NaN tie | `apps/web/src/match/match-results-assets.test.ts` |
| Pedro auto sequence | `packages/pedro/src/auto-sequence.integration.test.ts` |
| Parked artifacts | `packages/physics/src/physics-world.test.ts` |

### 12.2 Manual solo smoke (after every multiplayer PR)

1. WASD drive; stop at barriers (no tunneling)
2. Gamepad drive + intake/shoot
3. Gate auto-release when driving into gate zone (footprint overlap)
4. Intake a line of balls (no ghost colliders left behind)
5. Score increments correctly; match results ceremony (endmatch + video + tie on 0–0)
6. Match phase buttons work
7. Pedro auto completes without wall hit; wait steps hold + shoot
8. AUTO: robot passes through field artifacts; teleop: normal collisions
9. Practice NPC robots block player drive (SAT); parking scores all 4 robots
10. Reset returns to staging

### 12.3 Manual multiplayer smoke

1. Host + join LAN
2. Join client sees robot move when host drives
3. Host reset resets join view
4. Disconnect shows error, no solo corruption
5. Wrong version rejected

---

## 13. Risks, bugs & obstacles

### Simulation

| Risk | Severity | Mitigation |
|------|----------|------------|
| Client runs local Rapier | **Critical** | Join mode forbids `ArtifactWorld.tick` |
| Motif desync | High | Server owns `randomizeMotif` |
| Tick order change during refactor | **Critical** | Extract only; diff tick loop in review |
| Auto burst shoot parity | Medium | Port `autoBurstRef` logic to session |
| Multi-step frame single input sample | Medium | Document; per-tick buffer in Phase 6 |

### Networking

| Risk | Severity | Mitigation |
|------|----------|------------|
| CGNAT blocks port forward | High | playit primary path |
| Host disconnect | Medium | `match_ended` event |
| Snapshot too large | Medium | Strip debug logs; delta later |
| TCP head-of-line blocking | Low | Accept for v1 |

### Desktop / OS

| Risk | Severity | Mitigation |
|------|----------|------------|
| Windows Firewall | High | README + optional installer rule |
| SmartScreen unsigned exe | Medium | README |
| Gamepad on non-localhost UI | High | Always serve UI on localhost |
| WebView2 missing (Tauri) | Low | Use Electron v1 |

### Gameplay

| Risk | Severity | Mitigation |
|------|----------|------------|
| Single robot in early phases | Expected | Phase 2; 4 bodies locally in Phase 0.5 |
| Ghost artifact colliders after intake | **Fixed** | `parkArtifactBody` — regression in physics tests |
| Practice NPCs static only | Medium | Phase 0.5 dynamic bodies |
| Referee griefing | Low | Friends-only v1 |
| Audio desync | Low | Phase-based triggers |

---

## 14. Open decisions

| Decision | Recommendation | Decide before |
|----------|----------------|---------------|
| Launcher tech | Electron v1 | Phase 4 |
| Host UI as WS client | Yes | Phase 2 |
| Snapshot rate | 25 Hz | Phase 2 |
| First playable scope | 1 driver + spectators on LAN | Phase 2 |
| Practice 2v2 before net | Yes — Phase 0.5 | **Active** |
| Host-only audio | Yes v1 | Phase 3 |
| Room password | Optional Phase 5 | Phase 5 |

---

## Appendix A — Solo vs multiplayer code path

```typescript
// apps/web/src/session/session-mode.ts
export type SessionMode = 'solo' | 'host' | 'join';

// App.tsx (conceptual)
const mode = getSessionMode(); // from launcher query or menu

if (mode === 'solo') {
  // TODAY'S CODE — usePhysicsRobot + useMatchClock unchanged
} else {
  // SessionProvider wraps app
  // usePhysicsRobot disabled OR render-only adapter
  // useSessionClient feeds RenderState
}
```

---

## Appendix B — Key existing file references

| Purpose | Path |
|---------|------|
| App orchestrator | `apps/web/src/App.tsx` |
| Physics hook / loop | `apps/web/src/robot/usePhysicsRobot.ts` |
| Fixed timestep | `apps/web/src/robot/game-loop.ts` |
| Practice 2v2 robots | `apps/web/src/robot/match-robots.ts` |
| Artifact glue + Rapier | `apps/web/src/artifacts/artifact-world.ts` |
| Rapier world API | `packages/physics/src/physics-world.ts` |
| Mechanism FSM | `packages/mechanisms/src/artifact-simulation.ts` |
| Gate / intake geometry | `packages/mechanisms/src/geometry.ts` |
| DECODE rules / fouls / parking | `packages/game-decode/src/rules-engine.ts` |
| Pedro auto sequence | `packages/pedro/src/auto-sequence.ts` |
| PP path + waits parse | `packages/pedro/src/pp-io.ts` |
| Input sampler | `apps/web/src/input/drive-input-sampler.ts` |
| Match clock React | `apps/web/src/match/useMatchClock.ts` |
| Match clock pure | `packages/match/src/match-clock.ts` |
| Match audio cues | `apps/web/src/match/useMatchAudio.ts` |
| Results ceremony | `apps/web/src/match/MatchResultsCeremony.tsx` |
| Results scoring / videos | `apps/web/src/match/match-results-assets.ts` |
| FTC overlay | `apps/web/src/match/MatchFieldOverlay.tsx` |
| Field render | `apps/web/src/field/FieldCanvas.tsx` |
| v1 orchestrator reference | `archive/v1-full-sim-2026-06-18/.../match-director.ts` |
| v1 replay schema | `archive/v1-full-sim-2026-06-18/.../replay/src/replay.ts` |

---

## Appendix C — Approval checklist before net coding

- [x] Solo DECODE practice sim feature-complete for mechanisms, auto, match audio/ceremony
- [ ] Phase 0.5 practice 2v2 dynamic robot bodies complete
- [ ] Stakeholder confirms Phase 2 scope (1 driver + spectators OK for first LAN milestone)
- [ ] Stakeholder confirms Electron-first launcher
- [ ] Stakeholder confirms playit.gg as primary internet path
- [ ] Phase 0 determinism test merged before any net code

**Do not start Phase 1 (`SimSession`) until Phase 0.5 exit criteria pass. Do not start Phase 2 (WebSocket) until Phase 1 exit criteria pass.**
