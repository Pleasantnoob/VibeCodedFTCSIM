# Ground-up build roadmap

Rebuild the FTC DECODE simulator in small, verifiable steps. **Do not skip ahead** — each phase should be demo-able in the browser and stable before adding the next layer.

Prior art: `archive/v1-full-sim-2026-06-18/` (copy selectively, do not merge wholesale).

---

## Phase 0 — Shell (current)

**Goal:** Empty monorepo + web app that loads reliably.

- [x] Archive v1 codebase
- [x] Minimal `apps/web` (Vite + React + TypeScript)
- [x] `pnpm dev` / `pnpm build` green
- [x] Single page: project name, current phase, link to this doc

**Exit criteria:** Fresh clone → `pnpm install && pnpm dev` → page loads in &lt;2s, no console errors.

---

## Phase 1 — Field canvas

**Goal:** See the DECODE field with correct Pedro coordinates.

- [x] `@ftc-sim/field` — Pedro coords only (144×144 in, bottom-left origin)
- [x] PixiJS renderer: field image, grid overlay toggle, inch ↔ pixel mapping
- [x] Click field → log `(x, y)` in inches
- [x] Unit tests for coordinate transforms

**Exit criteria:** Click corners ≈ (0,0), (144,0), (144,144), (0,144). No physics yet.

---

## Phase 2 — Kinematic robot

**Goal:** Drive a robot sprite with keyboard before physics exists.

- [x] Robot sprite at a start pose
- [x] WASD + Q/E teleop (mecanum-style velocity, clamped speed)
- [x] Gamepad teleop (left stick move, right stick turn)
- [x] HUD: pose `(x, y, θ)`, speed, `controlSource: human`
- [x] Wall clamping (simple AABB, not Rapier yet)

**Exit criteria:** Robot moves smoothly, stops on key release, cannot leave field bounds.

---

## Phase 3 — Physics core

**Goal:** Replace kinematic motion with Rapier2D.

- [x] `@ftc-sim/physics` — world init, static walls, one dynamic robot body
- [x] Fixed timestep loop (decouple render FPS from sim Hz)
- [x] Spawn settle — robot stays within ~2″ of start after reset
- [x] Velocity-tracking drivetrain (not raw force spam)

**Exit criteria:** Reset → 3s idle → pose drift &lt; 2″, speed ≈ 0. Determinism test with fixed seed.

---

## Phase 4 — Match clock

**Goal:** Minimal match state machine, no scoring yet.

- [x] Phases: `setup` → `init` → `auto` → `transition` → `teleop` → `post`
- [x] UI synced to engine on load/reset (no stale HUD)
- [x] INIT / START AUTO / TELEOP / RESET buttons
- [x] Phase timer in top bar

**Exit criteria:** Button flow matches engine `snapshot()` every time.

---

## Phase 5 — Pedro paths

**Goal:** Import and visualize paths.

- [x] `@ftc-sim/pedro` — PedroJSON parse, Bezier sampling
- [x] Draw planned path on field
- [x] Load example path from JSON file upload

**Exit criteria:** Example path renders; points match Pedro coords.

---

## Phase 6 — Path follower

**Goal:** Robot follows a path in AUTO.

- [x] Follower (PIDF + holonomic decomposition) — port from archive with tests first
- [x] `controlSource: autonomous` during AUTO
- [x] Follower error overlay (translational + heading)
- [x] Human keypress cancels AUTO → teleop

**Exit criteria:** Example path completes without wall collision; error stays bounded.

---

## Phase 7 — DECODE field data

**Goal:** Data-driven field, not hard-coded sprites.

- [x] `@ftc-sim/season-decode` — field.json, zones, artifact positions
- [x] Zone debug overlay
- [x] Start poses per alliance

**Exit criteria:** Field layout matches game manual coordinates (spot-check 5 landmarks).

---

## Phase 8 — Game pieces & mechanisms

**Goal:** Intake, shoot, score — one mechanism at a time.

- [ ] Artifacts (static → held → released)
- [ ] Intake zone + F key
- [ ] Shooter + classifier zones
- [ ] `@ftc-sim/game-decode` rules engine + score HUD

**Exit criteria:** Manual teleop cycle: intake → drive → score → points increment.

---

## Phase 9 — Telemetry & replay

**Goal:** Record and replay for debugging / ML later.

- [ ] Tick recorder, CSV/JSON export
- [ ] Replay player in web UI
- [ ] Optional headless CLI batch runner

---

## Phase 10 — QA & E2E

**Goal:** Regression safety net.

- [ ] Vitest per package
- [ ] Playwright smoke (load, reset, WASD, phase buttons)
- [ ] Manual checklist in `docs/QA_LOG.md`

---

## Working rules

1. **One PR-sized phase at a time** — merge when exit criteria pass.
2. **Tests before features** when porting from archive.
3. **UI always reflects engine state** after init/reset.
4. **Reference archive, don’t resurrect it** — copy the minimum that passes tests.
5. **No new package** until the previous phase’s demo works in the browser.
