import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(path.join(webRoot, 'src/App.tsx'), 'utf8');

/** Guards against shipping a build stuck on the index.html "Loading FTC Sim…" splash. */
describe('App boot regression', () => {
  it('imports usePhysicsRobot when App calls the hook', () => {
    expect(appSrc).toContain('usePhysicsRobot(');
    expect(appSrc).toMatch(
      /import\s*\{[^}]*\busePhysicsRobot\b[^}]*\}\s*from\s*['"]\.\/robot\/usePhysicsRobot['"]/,
    );
  });

  it('typechecks (catches missing symbols and bad bot path helpers)', () => {
    execSync('pnpm exec tsc --noEmit', {
      cwd: webRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('production bundle builds', () => {
    execSync('pnpm exec vite build', {
      cwd: webRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });
  });
});
