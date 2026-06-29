import { describe, expect, it } from 'vitest';
import {
  parseAutoProgram,
  resolveAutoProgram,
  storedCountWaitMet,
  waitShouldShoot,
} from './auto-program.js';
import {
  effectiveAutoCruiseSpeedInS,
  estimateLeaveBudgetSec,
  shouldStopLoopForLeave,
} from './leave-budget.js';
import { AutoProgramRunner } from './auto-program-runner.js';
import { DEFAULT_KINEMATIC_ROBOT } from '@ftc-sim/robot';
import type { AutoSequence } from './auto-sequence.js';
import type { PathChain } from './paths.js';

const emptyChain = { paths: [] } as unknown as PathChain;

function stubSequence(): AutoSequence {
  return {
    displayChain: emptyChain,
    steps: [{ kind: 'wait', durationSec: 0.1 }],
    startPose: { x: 0, y: 0, heading: 0 },
  };
}

describe('parseAutoProgram', () => {
  it('parses a valid program', () => {
    const program = parseAutoProgram({
      version: 1,
      modules: {
        collect: { path: 'collect.pp' },
        leave: { path: 'leave.pp' },
      },
      steps: [
        { run: 'collect' },
        {
          loop: {
            body: [{ run: 'collect' }, { waitUntil: 'storedFull' }],
            until: 'leaveBudget',
          },
        },
        { run: 'leave' },
      ],
    });
    expect(program.steps.length).toBe(3);
    expect(program.waits?.storedFull?.min).toBe(3);
  });

  it('rejects unknown module references', () => {
    expect(() =>
      parseAutoProgram({
        version: 1,
        modules: {},
        steps: [{ run: 'missing' }],
      }),
    ).toThrow(/Unknown module/);
  });
});

describe('leave budget', () => {
  it('estimates leave duration from path steps', () => {
    const budget = estimateLeaveBudgetSec(
      [{ kind: 'wait', durationSec: 3 }],
      2,
      effectiveAutoCruiseSpeedInS(50),
    );
    expect(budget).toBeGreaterThan(4);
  });

  it('stops loop when time is low', () => {
    expect(shouldStopLoopForLeave(3, 4)).toBe(true);
    expect(shouldStopLoopForLeave(10, 4)).toBe(false);
  });
});

describe('AutoProgramRunner waits', () => {
  const limits = DEFAULT_KINEMATIC_ROBOT.limits;

  it('waits until stored full then continues', () => {
    const program = parseAutoProgram({
      version: 1,
      modules: { collect: { path: 'c.pp' } },
      steps: [{ waitUntil: 'storedFull' }, { run: 'collect' }],
      waits: {
        storedFull: { kind: 'storedCount', min: 3, timeoutSec: 1, onTimeout: 'continue' },
      },
    });
    const resolved = resolveAutoProgram(program, new Map([['collect', stubSequence()]]));
    const runner = new AutoProgramRunner();
    runner.startProgram(resolved, 50);
    runner.setContext({ storedCount: 1, timeRemainingSec: 25, inLaunchZone: false });

    let input = runner.updateHolonomic(0.05, limits);
    expect(input.brake).toBe(true);
    expect(runner.isInAutoWait()).toBe(true);
    expect(waitShouldShoot(program.waits!.storedFull!)).toBe(false);

    runner.setContext({ storedCount: 3 });
    input = runner.updateHolonomic(0.05, limits);
    expect(runner.isRunning()).toBe(true);
  });

  it('times out intake wait and proceeds with partial storage', () => {
    const program = parseAutoProgram({
      version: 1,
      modules: { shoot: { path: 's.pp' } },
      steps: [{ waitUntil: 'storedFull' }, { run: 'shoot' }],
      waits: {
        storedFull: { kind: 'storedCount', min: 3, timeoutSec: 0.2, onTimeout: 'continue' },
      },
    });
    const resolved = resolveAutoProgram(program, new Map([['shoot', stubSequence()]]));
    const runner = new AutoProgramRunner();
    runner.startProgram(resolved, 50, { intakeFullWaitTimeoutSec: 0.2 });
    runner.setContext({ storedCount: 2, timeRemainingSec: 25, inLaunchZone: false });
    runner.updateHolonomic(0.25, limits);
    expect(storedCountWaitMet(program.waits!.storedFull!, 2)).toBe(false);
    runner.updateHolonomic(0.05, limits);
    expect(runner.getRunnerDebug().programPhase).not.toBe('conditionalWait');
  });

  it('shoots during storedEmpty wait only in launch zone', () => {
    const program = parseAutoProgram({
      version: 1,
      modules: { leave: { path: 'l.pp' } },
      steps: [{ waitUntil: 'storedEmpty' }],
    });
    const resolved = resolveAutoProgram(program, new Map([['leave', stubSequence()]]));
    const runner = new AutoProgramRunner();
    runner.setContext({ storedCount: 2, timeRemainingSec: 5, inLaunchZone: false });
    runner.startProgram(resolved, 50);
    runner.updateHolonomic(0.05, limits);
    expect(runner.shouldAutoShoot(false)).toBe(false);
    expect(runner.shouldAutoShoot(true)).toBe(true);
  });

  it('loops until leave budget then exits loop', () => {
    const fastWait = (): AutoSequence => ({
      displayChain: emptyChain,
      steps: [{ kind: 'wait', durationSec: 0.01 }],
      startPose: { x: 0, y: 0, heading: 0 },
    });
    const program = parseAutoProgram({
      version: 1,
      modules: {
        collect: { path: 'c.pp' },
        leave: { path: 'l.pp' },
      },
      steps: [
        {
          loop: {
            body: [{ run: 'collect' }, { waitUntil: 'storedFull' }],
            until: 'leaveBudget',
          },
        },
        { run: 'leave' },
      ],
      waits: {
        storedFull: { kind: 'storedCount', min: 3, timeoutSec: 0.05, onTimeout: 'continue' },
      },
      leave: { safetyMarginSec: 1 },
    });
    const resolved = resolveAutoProgram(
      program,
      new Map([
        ['collect', fastWait()],
        ['leave', fastWait()],
      ]),
    );
    const runner = new AutoProgramRunner();
    runner.startProgram(resolved, 50, { leaveSafetyMarginSec: 1 });
    runner.setContext({ storedCount: 0, timeRemainingSec: 30, inLaunchZone: false });

    for (let i = 0; i < 200; i += 1) {
      runner.setContext({ timeRemainingSec: 30 - i * 0.1 });
      runner.updateHolonomic(0.05, limits);
      if (!runner.isRunning()) break;
    }

    expect(runner.getRunnerDebug().loopCount).toBeGreaterThan(0);
  });
});
