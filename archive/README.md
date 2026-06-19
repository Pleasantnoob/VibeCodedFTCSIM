# Archive

Snapshots of earlier simulator work. **Do not edit archived trees** — copy ideas or files into the active repo when rebuilding a feature.

## `v1-full-sim-2026-06-18`

Full monorepo built in one pass (June 2026):

- 14 packages (`core`, `physics`, `field`, `robot`, `pedro`, `game-decode`, …)
- Rapier2D physics, Pedro follower, DECODE rules, web GUI, CLI, Playwright E2E
- Docs: architecture, coordinates, QA log, manual checklist

Archived because the integrated stack was hard to reason about and debug incrementally. The active repo at the workspace root is a **ground-up rebuild** — see `docs/ROADMAP.md`.

### Run the old sim (read-only reference)

```bash
cd archive/v1-full-sim-2026-06-18
pnpm install
pnpm build
pnpm dev
```
