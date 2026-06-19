# Coordinate Systems

## Pedro (Canonical Internal)

Used for paths, telemetry, and follower math.

- Origin: bottom-left corner of field (0, 0)
- Range: x ∈ [0, 144], y ∈ [0, 144] inches
- Heading: radians, CCW positive; 0 = facing +X (right on field image)
- Right-hand coordinate system

## FTC SDK (DECODE Inverted)

- Origin: field center on tile surface
- DECODE: red alliance on audience-left; axes inverted vs typical square field
- Convert via `InvertedFTCCoordinates` then `PedroCoordinates`

## Physics (Rapier2D)

- Origin: field center
- Units: meters
- Y axis: up (Pedro Y flipped)
- Conversion: `pedroToPhysics(pose)` at physics boundary only

## Panels Canvas Preset

Pedro Pathing preset for field overlay:

```
offsetX = -72  (inches, scaled in renderer)
offsetY = 72
rotation = 270° (DEG_270)
```

Use `panelsPresetToCanvas()` in `@ftc-sim/field` for renderer alignment.

## Conversion Formulas

```
pedro.x = ftc.x + 72   (after inverted FTC conversion)
pedro.y = ftc.y + 72
physics.x = pedro.x * 0.0254 - 1.8288   (meters from center)
physics.y = pedro.y * 0.0254 - 1.8288
```

Heading is preserved (same CCW convention in Pedro and physics yaw).
