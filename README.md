# VibeCodedFTCSIM

Free FTC DECODE practice simulator for Windows. Drive a holonomic robot, score artifacts, run matches solo or with friends.

**Download:** [FTC-Sim-win-x64.zip](https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest) — extract the `FTC Sim` folder, run `FTC Sim.exe`.

- **Solo** — Play Solo in the launcher.
- **LAN** — Host shares `192.168.x.x:5191` on the same Wi‑Fi.
- **Internet** — Host forwards **TCP 5191**, shares `public-ip:5191`.

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

## Multiplayer (free LAN self-host)

No subscription or website hosting — run the match server on your PC and share your IP.

**Terminal 1 — match server (authoritative sim):**
```bash
pnpm dev:server    # WebSocket on 0.0.0.0:5191
```

**Terminal 2 — UI:**
```bash
pnpm dev           # http://localhost:5190
```

In the sim, open **Multiplayer** → **Host** (first player) or **Join** (friends). Default address: `127.0.0.1:5191`. On LAN, share `YOUR_LAN_IP:5191`. For internet friends, forward **TCP 5191** on your router and share `PUBLIC_IP:5191` — see [`docs/INTERNET_PLAY.md`](docs/INTERNET_PLAY.md).

Or run both at once: `pnpm dev:all`

### Desktop launcher (Phase 4)

**Download:** [Latest release zip](https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest) — extract the `FTC Sim` folder, run `FTC Sim.exe`. Solo, LAN, or internet (host port-forwards TCP 5191).

Build from source: `pnpm build:desktop`

Dev launcher (uses built `apps/web/dist` + `apps/match-server/dist`):

```bash
pnpm --filter @ftc-sim/web build
pnpm --filter @ftc-sim/match-server build
pnpm dev:desktop
```

See [`docs/MULTIPLAYER_MANIFEST.md`](docs/MULTIPLAYER_MANIFEST.md) for the full plan.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phased build plan.

## Prior work

The first integrated simulator lives in [`archive/v1-full-sim-2026-06-18/`](archive/v1-full-sim-2026-06-18/). This repo is a ground-up rebuild focused on incremental, testable layers.

## License

BSD-3-Clause — see [LICENSE](./LICENSE). Aligned with the Pedro Pathing ecosystem.
