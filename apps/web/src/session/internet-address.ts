const STORAGE_KEY = 'ftc-sim-internet-address';
const LEGACY_STORAGE_KEY = 'ftc-sim-playit-address';

export interface HostInfo {
  matchPort: number;
  lanAddress: string;
  publicIp: string | null;
  suggestedInternetAddress: string | null;
  internetAddress: string;
}

export interface PrepareInternetHostResult {
  ok: boolean;
  inviteAddress: string;
  lanAddress: string;
  publicIp: string | null;
  firewallOk: boolean;
  upnpOk: boolean;
  notes: string[];
}

export function readInternetAddressLocal(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      localStorage.getItem(STORAGE_KEY)?.trim() ??
      localStorage.getItem(LEGACY_STORAGE_KEY)?.trim() ??
      ''
    );
  } catch {
    return '';
  }
}

export function writeInternetAddressLocal(address: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = address.trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    /* private browsing */
  }
}

export async function fetchHostInfo(): Promise<HostInfo | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch('/api/host-info');
    if (!res.ok) return null;
    return (await res.json()) as HostInfo;
  } catch {
    return null;
  }
}

export async function fetchInternetAddressRemote(): Promise<string> {
  const info = await fetchHostInfo();
  return info?.internetAddress?.trim() ?? '';
}

export async function saveInternetAddressRemote(address: string): Promise<void> {
  try {
    await fetch('/api/host-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ internetAddress: address.trim() }),
    });
  } catch {
    /* optional when dev server has no API */
  }
}

export async function syncInternetAddress(address: string): Promise<void> {
  writeInternetAddressLocal(address);
  await saveInternetAddressRemote(address);
}

/** Firewall + UPnP + public IP detect; saves invite address (Electron desktop only). */
export async function prepareInternetHostRemote(): Promise<PrepareInternetHostResult | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch('/api/prepare-internet-host', { method: 'POST' });
    if (!res.ok) return null;
    return (await res.json()) as PrepareInternetHostResult;
  } catch {
    return null;
  }
}

/** @deprecated use readInternetAddressLocal */
export const readPlayitAddressLocal = readInternetAddressLocal;
/** @deprecated use fetchInternetAddressRemote */
export const fetchPlayitAddressRemote = fetchInternetAddressRemote;
/** @deprecated use syncInternetAddress */
export const syncPlayitAddress = syncInternetAddress;
