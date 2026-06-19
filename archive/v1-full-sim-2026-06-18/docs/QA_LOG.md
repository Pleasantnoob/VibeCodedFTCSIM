# QA Log — DECODE Simulator v2

**Date:** 2026-06-18  
**URL:** http://localhost:5190/  
**Build:** post sim-stabilization + keybind fixes  
**Automated:** `pnpm build`, `pnpm test`, `pnpm --filter @ftc-sim/web test:e2e`

## Plan test sequence

| Step | Action | Result | Notes |
|------|--------|--------|-------|
| 1 | Load page | **PASS** | Field + robot at red F1; overlay clears < 30s (E2E) |
| 2 | RESET (no match) | **PASS** | `stability.test.ts`: spawn drift < 3", speed < 5 in/s |
| 3 | INIT | **PASS** | Phase → `init`; event log entry (E2E + UI sync fix) |
| 4 | START AUTO | **PASS** | Phase → `auto`; clock ~30s counts down in real time (E2E) |
| 5 | Wait ~5s | **PASS** | Sim time tracks wall clock (~1:1); max speed < 80 in/s after velocity clamp |
| 6 | TELEOP / WASD | **PASS** | Drive keys auto-take control during auto; click field for focus; W/S/A/D robot-relative |
| 7 | F / G / Space | **PASS** | Mechanism keys bound; Space prevented from scrolling |
| 8 | PAUSE / STEP | **PASS** | `pause()` stops `update()` ticks; `step(1)` advances one tick |
| 9 | RESET | **PASS** | Full respawn; sim time → 0 (`__ftcSim.snapshot().time`) |
| 10 | Export replay | **PASS** | Footer button triggers JSON download |

## Snapshot samples (`window.__ftcSim.snapshot()`)

After RESET (idle):

```json
{ "phase": "init", "time": 0, "speed": 0, "controlSource": "none" }
```

During AUTO (~3s):

```json
{ "phase": "auto", "speed": "< 55", "controlSource": "autonomous" }
```

After holding `W` (drive takeover):

```json
{ "phase": "auto", "controlSource": "human", "speed": "< 55" }
```

## MANUAL_TEST_CHECKLIST.md sign-off

| Section | Result |
|---------|--------|
| Physics / teleop drive | **PASS** — WASD + Q/E; no fling after spawn settle + speed clamp |
| Artifacts | **PASS** — staging tests green; spike y-offsets applied |
| Shooter | **PASS** — classifier targets zone centroids from `field.json` |
| Match / Rules | **PASS** — INIT → AUTO → TELEOP flow; score panel live |
| Driver Station | **PASS** — keys work after field click; auto-drive on WASD during AUTO |
| Replay & Analytics | **PASS** — export + analytics panel populate during match |
| UI | **PASS** — 1280×720 layout; zoom wheel; no console errors in E2E |

## Known limitations

- Rapier WASM init deprecation warning (upstream `@dimforge/rapier2d-compat@0.19.3`; tests still pass).
- Click the field once if keys seem dead (focus); hint shown in Mechanisms panel.

## Completion gate

- [x] `pnpm build && pnpm test` green
- [x] `pnpm --filter @ftc-sim/web test:e2e` green
- [x] Browser QA log — all checklist items PASS
- [x] No robot fling on reset / auto / teleop (stability + E2E)
- [x] Phase clock ~1:1 real time (`stability.test.ts` ±15% over 1s; E2E clock drop over 2s wall time)
