export type PhysicsLogLevel = 'info' | 'warn' | 'error';

export interface PhysicsLogEntry {
  time: number;
  level: PhysicsLogLevel;
  message: string;
}

const MAX_LOG_ENTRIES = 40;
const entries: PhysicsLogEntry[] = [];

function push(level: PhysicsLogLevel, message: string): void {
  const entry = { time: performance.now(), level, message };
  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) entries.shift();

  const prefix = `[physics] ${message}`;
  if (level === 'error') console.error(prefix);
  else if (level === 'warn') console.warn(prefix);
  else console.info(prefix);
}

export const physicsLog = {
  info: (message: string) => push('info', message),
  warn: (message: string) => push('warn', message),
  error: (message: string) => push('error', message),
  getEntries: () => [...entries],
  clear: () => {
    entries.length = 0;
  },
  formatForUi: () =>
    entries
      .slice(-12)
      .map((entry) => `[${entry.level}] ${entry.message}`)
      .join('\n'),
};
