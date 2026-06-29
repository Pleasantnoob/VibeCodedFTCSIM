export type MechanismLogCategory =
  | 'gate'
  | 'shoot'
  | 'intake'
  | 'ramp'
  | 'flight'
  | 'physics'
  | 'cmd';

export interface MechanismLogEntry {
  t: number;
  category: MechanismLogCategory;
  message: string;
  data?: Record<string, unknown>;
}

const MAX_ENTRIES = 150;

export class MechanismLogger {
  private entries: MechanismLogEntry[] = [];

  log(
    category: MechanismLogCategory,
    message: string,
    data?: Record<string, unknown>,
    simTime = 0,
  ): void {
    const entry: MechanismLogEntry = { t: simTime, category, message, data };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  getEntries(): MechanismLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
