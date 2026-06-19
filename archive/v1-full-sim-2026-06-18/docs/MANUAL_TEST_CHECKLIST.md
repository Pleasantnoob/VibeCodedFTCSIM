# Manual Test Checklist — DECODE Simulator v2

Sign off each item before marking release complete.

## Physics
- [ ] Robot drives forward/back/strafe/rotate smoothly in TELEOP
- [ ] Walls and goal obstacles block robot
- [ ] Repeated runs with same seed produce identical pose at tick 1200

## Artifacts
- [ ] Field artifacts spawn on reset
- [ ] Intake (F key) picks up artifacts
- [ ] Storage holds exactly 3 artifacts
- [ ] 4th intake attempt rejects artifact
- [ ] HP Load spawns artifact in loading zone

## Shooter
- [ ] Flywheel spins up (G key)
- [ ] Space fires shot with visible arc
- [ ] Scoring updates when shot hits classifier zone

## Match / Rules
- [ ] INIT → START AUTO advances phase timer
- [ ] Score panel updates without manual entry
- [ ] TELEOP mode allows driving

## Driver Station
- [ ] WASD + Q/E controls work
- [ ] PAUSE / STEP / RESET work
- [ ] Path upload runs autonomous routine

## Replay & Analytics
- [ ] Export replay downloads JSON
- [ ] Analytics panel shows distance, shots, intake rate

## UI
- [ ] Panel layout renders at 1280×720+
- [ ] Zoom wheel adjusts field view
- [ ] No console errors during 2-minute match
