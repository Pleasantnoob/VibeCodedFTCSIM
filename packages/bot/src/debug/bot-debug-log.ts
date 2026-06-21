import type { BotDebugLogCategory } from '../types.js';

export type BotDebugLogLevel = 'info' | 'warn' | 'task';

export interface BotDebugLogEntry {
  tick: number;
  elapsedSec: number;
  robotId: string;
  level: BotDebugLogLevel;
  category: BotDebugLogCategory;
  /** Single-line summary for humans and agents — no nested JSON required. */
  message: string;
  data?: Record<string, unknown>;
}

/** Flat one-liner for clipboard / agent parsing. */
export function formatBotDebugLogEntry(entry: BotDebugLogEntry): string {
  const head = `${entry.robotId} t=${entry.elapsedSec.toFixed(1)}s`;
  return `[${entry.category}] ${head} | ${entry.message}`;
}

export class BotDebugLog {
  private entries: BotDebugLogEntry[] = [];
  private readonly maxEntries: number;
  private enabled: boolean;

  constructor(maxEntries = 400, enabled = true) {
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

  getEntries(): BotDebugLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
