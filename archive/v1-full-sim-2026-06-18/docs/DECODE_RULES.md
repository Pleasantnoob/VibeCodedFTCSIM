# DECODE Game Rules (Simulator Reference)

Machine-readable rules: [`packages/game-decode/rules.json`](../packages/game-decode/rules.json).

Source: [FTC DECODE Game Manual §10](https://ftc-resources.firstinspires.org/ftc/game/manual-10) (2025–2026 season).

## Match timing

| Period | Duration |
|--------|----------|
| Autonomous (AUTO) | 30 s |
| AUTO → TELEOP transition | 8 s (15 s at FIRST Championship) |
| TeleOp (TELEOP) | 120 s |

## Scoring elements

- **Artifacts:** 5 inch diameter balls (purple and green). 24 purple + 12 green on field.
- **Pre-load:** Each robot may start with up to **3** artifacts from alliance area.
- **Robot storage (sim default):** Max **3** indexed artifacts (configurable per robot).

## Scoring (Table 10-2)

| Achievement | AUTO | TELEOP |
|-------------|------|--------|
| LEAVE launch line | 3 | — |
| CLASSIFIED artifact | 3 | 3 |
| OVERFLOW artifact | 1 | 1 |
| DEPOT | — | 1 |
| PATTERN (per matching ramp slot) | 2 | 2 |
| Partial BASE return | — | 5 |
| Full BASE return | — | 10 |
| Both alliance robots full BASE | — | 10 bonus |

## Artifact path

1. Enter GOAL through open top, pass archway, pass **diverting square** (classifier).
2. **CLASSIFIED:** transitions directly to RAMP (3 pts).
3. **OVERFLOW:** does not meet classified criteria (1 pt).
4. **DEPOT:** artifact over alliance depot at end of match (1 pt).
5. **PATTERN:** at end of AUTO/TELEOP, ramp slots matching obelisk MOTIF (2 pts each, gate must retain).

## Obelisk motifs

| ID | Pattern (×3 for 9 ramp indices) |
|----|----------------------------------|
| 21 | G, P, P |
| 22 | P, G, P |
| 23 | P, P, G |

## Coordinate notes

- Simulator uses **Pedro coordinates**: 144×144 inches, origin bottom-left (row 1 = audience/south, column A = west).
- Pedro Visualizer drawable area is **141.5×141.5** — renderer scales physics coords by `141.5/144` to align with `decode.webp`.
- Tile grid: 6×6 × 24 in. Columns A–C = blue, D–F = red (manual G304).
- Artifact staging follows manual §10.3.1: spikes on seams V (blue) and Z (red), loading zones A1/F1, motifs GPP/PGP/PPG by row.
- Robot starts (`red_near`, `blue_near`) are in F1/A1 launch corners per G304.
- Physics obstacles merged from virtual_robot `Decode.java` + manual zone polygons in `field.json`.

## Simulator enforcement

The `@ftc-sim/game-decode` rules engine evaluates scoring from physical state only — no manual score entry.
