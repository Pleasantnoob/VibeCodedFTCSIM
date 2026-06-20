# VibeCodedFTCSIM

Free FTC DECODE practice simulator for Windows. Drive a holonomic robot, score artifacts, run matches solo or with friends.

Repository: [github.com/Pleasantnoob/VibeCodedFTCSIM](https://github.com/Pleasantnoob/VibeCodedFTCSIM)

## Download and run

**Windows:** [FTC-Sim-win-x64.zip](https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest) — unzip with **WinRAR** or **7-Zip** (Windows built-in Extract often fails), open the `FTC Sim` folder, run `FTC Sim.exe`.

**Mac (join only):** [FTC Sim Player for Mac](https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest) — open the `.dmg` and drag to Applications. Details: [`docs/DESKTOP_MAC.md`](docs/DESKTOP_MAC.md).

## Features

- **DECODE field** — full-season layout, artifacts, obelisk motif, match scoring and results ceremony
- **Holonomic drive** — keyboard teleop with field or robot-centric controls; customizable keybinds
- **Robot tuning** — footprint, mass, velocity limits, and optional preload from player settings
- **Match flow** — setup → auto → teleop → endgame; infinite teleop practice mode
- **Pedro paths** — load `.pp` paths and run auto on the field
- **Mechanisms** — intake, shooter, gate, and human-player station interactions
- **Multiplayer** — free LAN/internet host; lobby slot pick (blue/red corners); up to 4 drivers
- **Desktop launcher** — solo, host match, join by address, copy LAN/public invite, auto-updates

## How it works

The desktop app is a launcher plus match server. One player **hosts** the sim on their PC; others **join** over the network.

| Mode | What you do |
|------|-------------|
| **Solo** | Launcher → play on your machine only |
| **LAN** | Host shares `192.168.x.x:5191`; joiners paste that address |
| **Internet** | Host forwards **TCP 5191** on the router, shares `public-ip:5191` |

Same-PC testing in the browser: use `127.0.0.1:5191` with `pnpm dev:all`. Internet setup: [`docs/INTERNET_PLAY.md`](docs/INTERNET_PLAY.md).

## Quick start (development)

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
apps/desktop/      Windows Electron launcher (host + join + solo)
apps/desktop-mac/  Mac Electron launcher (join only)
apps/match-server/ Authoritative multiplayer sim (WebSocket :5191)
packages/          Monorepo libraries (field, robot, physics, game-decode, …)
docs/              Internet play, Mac desktop notes
scripts/           Asset sync and tooling
vendor/            FTC Live asset cache (see vendor/README.md)
```

## Development

```bash
pnpm test        # unit tests across packages
pnpm build       # compile all packages
pnpm typecheck   # TypeScript check
```

### Browser multiplayer (dev)

**Terminal 1 — match server:**
```bash
pnpm dev:server    # WebSocket on 0.0.0.0:5191
```

**Terminal 2 — UI:**
```bash
pnpm dev           # http://localhost:5190
```

Or both: `pnpm dev:all`. In the sim, open **Multiplayer** → **Host** or **Join** (default `127.0.0.1:5191`).

### Desktop launcher (from source)

Build a Windows release zip:

```bash
pnpm build:desktop
```

Output: `apps/desktop/release/FTC-Sim-win-x64.zip` and an unzipped `apps/desktop/release/FTC-Sim/` folder.

Run the launcher in dev (after building web + match-server):

```bash
pnpm --filter @ftc-sim/web build
pnpm --filter @ftc-sim/match-server build
pnpm dev:desktop
```

Mac release builds run on GitHub Actions: `pnpm release:desktop-mac`

## License

BSD-3-Clause — see [LICENSE](./LICENSE). Aligned with the Pedro Pathing ecosystem.
