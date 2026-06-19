# VibeCodedFTCSIM

FTC **DECODE** (2025–26) practice simulator — holonomic drive, Rapier artifact physics, DECODE rules, multi-robot field, and FTC Live–style match overlay.

Repository: [github.com/Pleasantnoob/VibeCodedFTCSIM](https://github.com/Pleasantnoob/VibeCodedFTCSIM)

## Quick start

```bash
pnpm install
pnpm dev    # http://localhost:5190
```

Requires **Node.js 20+** and [pnpm](https://pnpm.io/).

If match sounds or results video are missing after clone, run once (with [FTC Live 2026](https://ftc-scoring.firstinspires.org/local/2026) installed locally):

```powershell
.\scripts\copy-ftc-assets.ps1
```

## Repository layout

```
apps/web/          Vite + React sim UI
packages/          Monorepo libraries (field, robot, physics, game-decode, …)
docs/              Roadmap, multiplayer manifest, research papers
scripts/           Asset sync and one-off tooling
vendor/            FTC Live asset cache & third-party bundles (see vendor/README.md)
archive/           Frozen v1 simulator snapshot (reference only)
reference/         Local git clones of Pedro, Road Runner, etc. (gitignored)
```

## Development

```bash
pnpm test        # unit tests across packages
pnpm build       # compile all packages
pnpm typecheck   # TypeScript check
```

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased build plan.

## Prior work

The first integrated simulator lives in [`archive/v1-full-sim-2026-06-18/`](archive/v1-full-sim-2026-06-18/). This repo is a ground-up rebuild focused on incremental, testable layers.

## License

BSD-3-Clause — see [LICENSE](./LICENSE). Aligned with the Pedro Pathing ecosystem.
