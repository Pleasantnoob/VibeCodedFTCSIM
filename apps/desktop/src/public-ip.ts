let cached: { ip: string; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function fetchPublicIp(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.ip;
  }
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    const ip = data.ip?.trim();
    if (!ip) return null;
    cached = { ip, at: Date.now() };
    return ip;
  } catch {
    return null;
  }
}

export function suggestedInternetAddress(publicIp: string | null, port: number): string | null {
  return publicIp ? `${publicIp}:${port}` : null;
}
