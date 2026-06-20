# FTC Sim Player (Mac)

Join-only desktop launcher for macOS. Connect to a Windows (or any) host and play — **no hosting from Mac**.

## Download

Get **FTC Sim Player for Mac** from [GitHub Releases](https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases). Look for:

- **`FTC-Sim-Player-{version}-mac.zip`** — easiest to share (both DMGs + install guide)
- `FTC-Sim-Player-{version}-mac-arm64.dmg` — Apple Silicon only
- `FTC-Sim-Player-{version}-mac-x64.dmg` — Intel Mac only

**Install:** open the `.dmg` → drag **FTC Sim Player** to **Applications** → open from Applications.

Unsigned beta builds may show a Gatekeeper warning. Right-click → Open, or allow in System Settings → Privacy & Security.

## Build & publish without a Mac (Windows)

GitHub Actions builds the Mac `.dmg` on Apple's cloud — you never need a Mac locally.

1. Commit and push the `apps/desktop-mac/` code to GitHub.
2. From your Windows PC, run:

```bash
pnpm release:desktop-mac
```

Or manually: **GitHub → Actions → Desktop Mac Release → Run workflow**.

3. When the workflow finishes (~10–15 min), open [Releases](https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases) and download **`FTC-Sim-Player-mac-{version}.zip`**.
4. Send that zip to Mac friends (same idea as the Windows zip).

The zip contains both Apple Silicon and Intel installers plus `INSTALL-MAC.txt`.

## How to join

1. Ask your friend to **Host Match** on Windows (FTC Sim desktop app).
2. They share their address — usually `192.168.x.x:5191` on the same Wi‑Fi, or `public-ip:5191` if they forwarded TCP port 5191.
3. Open **FTC Sim Player**, paste the address, click **Join Match**.
4. Pick your robot slot and drive.

The Mac app serves the sim UI on `127.0.0.1:5190` locally (required for gamepad support) and connects to the host’s match server on port **5191**.

## Build from source (macOS required for packaging)

```bash
pnpm install
pnpm --filter @ftc-sim/desktop-mac prepare:resources
pnpm dev:desktop-mac
```

Full release build (`.dmg` + `.zip`):

```bash
pnpm build:desktop-mac
# or from apps/desktop-mac:
pnpm release
```

Output: `apps/desktop-mac/release/FTC-Sim-Player-{version}-mac-{arch}.dmg` and `.zip`.

### FTC Live assets (match sounds)

For full match audio, install [FTC Live 2026](https://ftc-scoring.firstinspires.org/local/2026) once, then run:

```bash
node scripts/copy-ftc-assets.mjs
```

On macOS, assets are read from:

- `~/Library/Application Support/firstinspires/ftclive-2026-default/data/public`
- `~/Documents/FIRST Tech Challenge Live/DECODE (2026)/public`

The join client works without audio; sounds are optional.

## CI release

Push a tag `desktop-mac-v*` or run the **Desktop Mac Release** workflow manually on GitHub Actions (`macos-15`, arm64 + x64 matrix).

Upload artifacts to GitHub Releases as **FTC Sim Player for Mac**. Include `latest-mac.yml` per architecture for auto-update.

## Architecture (isolated from Windows)

```
apps/desktop-mac/     Mac player launcher (this app)
apps/desktop/         Windows full launcher — DO NOT MODIFY for Mac work
apps/web/             Shared sim UI
packages/*            Shared game libraries
```

No code is shared between `apps/desktop` and `apps/desktop-mac` — files are copied and simplified independently.

## Code signing (phase 2)

Phase 1 ships unsigned builds. For distribution without Gatekeeper warnings:

1. Apple Developer ID Application certificate
2. Set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` in CI
3. Notarize with `afterSign` hook (see [electron-builder mac docs](https://www.electron.build/docs/mac/))

Entitlements template: `apps/desktop-mac/build/entitlements.mac.plist`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Cannot connect | Confirm host is running, same network, correct `IP:5191` |
| Gamepad not working | Use the desktop app (not browser-only) — localhost context is required |
| “App is damaged” / Gatekeeper | Unsigned build — right-click Open, or sign/notarize |
| Missing sounds | Run `node scripts/copy-ftc-assets.mjs` after installing FTC Live |

## Related docs

- [INTERNET_PLAY.md](./INTERNET_PLAY.md) — port forwarding for internet play (host side)
- [MULTIPLAYER_MANIFEST.md](./MULTIPLAYER_MANIFEST.md) — multiplayer architecture
