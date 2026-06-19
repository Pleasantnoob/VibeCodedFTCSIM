import { expect, test } from '@playwright/test';

function parseClock(text: string): number {
  const match = text.match(/Clock:\s*([\d.]+)s/);
  return match ? Number(match[1]) : NaN;
}

test.describe('DECODE simulator smoke', () => {
  test('loads, runs auto phase, stays stable, resets', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#root')).toContainText('FTC DECODE Simulator');
    await expect(page.locator('.init-overlay')).toHaveCount(0, { timeout: 30_000 });

    await page.getByRole('button', { name: 'INIT' }).click();
    await expect(page.locator('.topbar-stats')).toContainText('Phase: init');

    await page.getByRole('button', { name: 'START AUTO' }).click();
    await expect(page.locator('.topbar-stats')).toContainText('Phase: auto');

    const clockStart = parseClock(await page.locator('.topbar-stats').innerText());
    expect(clockStart).toBeGreaterThan(25);

    await page.waitForTimeout(2000);
    const clockAfter = parseClock(await page.locator('.topbar-stats').innerText());
    expect(clockAfter).toBeLessThan(clockStart);

    await page.waitForTimeout(1000);
    const snapshot = await page.evaluate(() => {
      const sim = (window as unknown as { __ftcSim?: { snapshot: () => unknown } }).__ftcSim;
      return sim?.snapshot() as { phase?: string; speed?: number };
    });
    expect(snapshot.phase).toBe('auto');
    expect(snapshot.speed ?? 999).toBeLessThan(80);

    await page.getByRole('button', { name: 'RESET' }).click();
    await page.waitForTimeout(500);
    const afterReset = await page.evaluate(() => {
      const sim = (window as unknown as { __ftcSim?: { snapshot: () => { time?: number } } }).__ftcSim;
      return sim?.snapshot()?.time ?? 999;
    });
    expect(afterReset).toBeLessThan(1);
  });

  test('WASD drives robot after clicking field (no TELEOP button required during auto)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.init-overlay')).toHaveCount(0, { timeout: 30_000 });

    await page.getByRole('button', { name: 'INIT' }).click();
    await page.getByRole('button', { name: 'START AUTO' }).click();
    await page.locator('main.center').click();

    const before = await page.evaluate(() => {
      const sim = (window as unknown as { __ftcSim?: { snapshot: () => { pose?: { x: number; y: number } } } }).__ftcSim;
      return sim?.snapshot()?.pose;
    });
    expect(before).toBeDefined();

    await page.keyboard.down('w');
    await page.waitForTimeout(1500);
    await page.keyboard.up('w');

    const after = await page.evaluate(() => {
      const sim = (window as unknown as {
        __ftcSim?: {
          snapshot: () => {
            pose?: { x: number; y: number };
            controlSource?: string;
            speed?: number;
          };
        };
      }).__ftcSim;
      return sim?.snapshot();
    });

    expect(after?.controlSource).toBe('human');
    const moved = Math.hypot(after!.pose!.x - before!.x, after!.pose!.y - before!.y);
    expect(moved).toBeGreaterThan(5);
    expect(after?.speed ?? 999).toBeLessThan(80);
  });
});
