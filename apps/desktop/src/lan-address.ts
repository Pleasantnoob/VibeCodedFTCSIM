import { networkInterfaces } from 'node:os';

export function lanAddress(port: number): string {
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return `${entry.address}:${port}`;
      }
    }
  }
  return `127.0.0.1:${port}`;
}
