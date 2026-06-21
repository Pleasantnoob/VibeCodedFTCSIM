import type { BotDebugLogCategory, BotDebugState, BotTaskKind } from '../types.js';

export type BotDebugLogLevel = 'info' | 'warn' | 'task';

export interface BotDebugLogEntry {
  tick: number;
  elapsedSec: number;
  robotId: string;
  level: BotDebugLogLevel;
  category: BotDebugLogCategory;
  message: string;
  data?: Record<string, unknown>;
}

function fmtVec(point: { x: number; y: number } | null | undefined): string {
  if (!point) return '(—,—)';
  return `(${point.x.toFixed(1)},${point.y.toFixed(1)})`;
}

export function formatBotDebugLogEntry(entry: BotDebugLogEntry): string {
  const head = `[${entry.category}/${entry.level}] ${entry.robotId} tick=${entry.tick} t=${entry.elapsedSec.toFixed(2)}s`;
  const body = entry.data ? `${entry.message} ${JSON.stringify(entry.data)}` : entry.message;
  return `${head} ${body}`;
}

export class BotDebugLog {
  private entries: BotDebugLogEntry[] = [];
  private readonly maxEntries: number;
  private enabled: boolean;
  private navTraceAccumulator = new Map<string, number>();

  constructor(maxEntries = 2000, enabled = true) {
    this.maxEntries = maxEntries;
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  log(
    tick: number,
    elapsedSec: number,
    robotId: string,
    category: BotDebugLogCategory,
    level: BotDebugLogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.enabled) return;
    this.entries.push({ tick, elapsedSec, robotId, level, category, message, data });
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  logTaskChange(
    tick: number,
    elapsedSec: number,
    robotId: string,
    prev: BotTaskKind,
    next: BotTaskKind,
    detail: string,
  ): void {
    if (prev === next) return;
    this.log(tick, elapsedSec, robotId, 'task', 'task', `${prev} → ${next}: ${detail}`);
  }

  logReplan(
    tick: number,
    elapsedSec: number,
    robotId: string,
    reason: string,
    data?: Record<string, unknown>,
  ): void {
    this.log(tick, elapsedSec, robotId, 'plan', 'info', `replan=${reason}`, data);
  }

  logPlan(
    tick: number,
    elapsedSec: number,
    robotId: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.log(tick, elapsedSec, robotId, 'plan', 'info', message, data);
  }

  logMotion(
    tick: number,
    elapsedSec: number,
    robotId: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.log(tick, elapsedSec, robotId, 'motion', 'info', message, data);
  }

  logDrive(
    tick: number,
    elapsedSec: number,
    robotId: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.log(tick, elapsedSec, robotId, 'drive', 'info', message, data);
  }

  logWarn(
    tick: number,
    elapsedSec: number,
    robotId: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.log(tick, elapsedSec, robotId, 'warn', 'warn', message, data);
  }

  logNavTrace(
    tick: number,
    elapsedSec: number,
    robotId: string,
    nav: NonNullable<BotDebugState['nav']>,
    intervalSec = 0.25,
  ): void {
    const lastAt = this.navTraceAccumulator.get(robotId) ?? -Infinity;
    if (elapsedSec - lastAt < intervalSec && nav.flags.length === 0) return;
    this.navTraceAccumulator.set(robotId, elapsedSec);

    this.log(tick, elapsedSec, robotId, 'motion', 'info', 'nav trace', {
      pose: nav.pose,
      vel: nav.velocity,
      taskTarget: fmtVec(nav.taskTarget),
      rawTaskTarget: fmtVec(nav.rawTaskTarget),
      motionGoal: fmtVec(nav.motionGoal),
      pursuit: fmtVec(nav.pursuitTarget),
      wp: `${nav.waypointIndex}/${nav.pathLength}`,
      dist: {
        task: +nav.distTask.toFixed(1),
        goal: +nav.distGoal.toFixed(1),
        pursuit: +nav.distPursuit.toFixed(1),
      },
      graph: {
        start: nav.startNode,
        goal: nav.goalNode,
        path: nav.nodePath.join('→'),
      },
      pathSig: nav.pathSignature,
      driveSource: nav.driveSource,
      drive: {
        raw: nav.driveRaw,
        avoid: nav.driveAvoid,
        barrier: nav.driveBarrier,
        final: nav.driveFinal,
      },
      flags: nav.flags.length > 0 ? nav.flags : undefined,
    });

    if (nav.flags.length > 0) {
      this.logWarn(tick, elapsedSec, robotId, nav.flags.join(' · '), {
        taskTarget: fmtVec(nav.taskTarget),
        pursuit: fmtVec(nav.pursuitTarget),
        distTask: +nav.distTask.toFixed(1),
        distGoal: +nav.distGoal.toFixed(1),
        nodePath: nav.nodePath.join('→'),
      });
    }
  }

  logState(tick: number, elapsedSec: number, state: BotDebugState): void {
    const parts = [
      `task=${state.task}`,
      state.artifactId ? `artifact=${state.artifactId}` : null,
      `stored=${state.storedCount}`,
      state.inLaunchZone ? 'launch=1' : 'launch=0',
      state.aligned ? 'aligned=1' : 'aligned=0',
      state.stuckPhase !== 'normal' ? `stuck=${state.stuckPhase}` : null,
      state.atGoal ? 'atGoal=1' : null,
      state.lastReplanReason ? `replan=${state.lastReplanReason}` : null,
      state.nav ? `distTask=${state.nav.distTask.toFixed(0)} distGoal=${state.nav.distGoal.toFixed(0)}` : null,
      state.nav?.flags.length ? `flags=${state.nav.flags.join(',')}` : null,
    ].filter(Boolean);
    this.log(tick, elapsedSec, state.robotId, 'state', 'info', parts.join(' '));
  }

  getEntries(): BotDebugLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.navTraceAccumulator.clear();
  }
}
