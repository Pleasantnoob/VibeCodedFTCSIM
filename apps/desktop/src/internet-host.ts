import { spawnSync } from 'node:child_process';
import natUpnp from 'nat-upnp';
import { lanAddress } from './lan-address';
import { writeHostSettings } from './host-settings';
import { fetchPublicIp, suggestedInternetAddress } from './public-ip';

const FIREWALL_RULE = 'FTC Sim Match Server';

let upnpClient: ReturnType<typeof natUpnp.createClient> | null = null;

export interface PrepareInternetHostResult {
  inviteAddress: string;
  lanAddress: string;
  publicIp: string | null;
  firewallOk: boolean;
  upnpOk: boolean;
  notes: string[];
}

function lanIpv4(): string {
  const addr = lanAddress(5191);
  return addr.split(':')[0] ?? '127.0.0.1';
}

function ensureWindowsFirewall(port: number): { ok: boolean; note: string } {
  if (process.platform !== 'win32') {
    return { ok: true, note: 'Firewall: skipped (not Windows)' };
  }

  const check = spawnSync(
    'netsh',
    ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`],
    { encoding: 'utf8', windowsHide: true },
  );
  if (check.stdout?.includes(FIREWALL_RULE)) {
    return { ok: true, note: 'Firewall: rule already exists' };
  }

  const add = spawnSync(
    'netsh',
    [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${FIREWALL_RULE}`,
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${port}`,
      'enable=yes',
      'profile=private,domain',
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  if (add.status === 0) {
    return { ok: true, note: 'Firewall: allowed inbound TCP ' + port };
  }

  return {
    ok: false,
    note: 'Firewall: could not add rule (run as admin or allow manually)',
  };
}

function mapUpnpPort(port: number, localIp: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = upnpClient ?? natUpnp.createClient();
    upnpClient = client;
    const timeout = setTimeout(() => resolve(false), 8000);
    client.portMapping(
      {
        public: port,
        private: { port, host: localIp },
        ttl: 0,
        description: 'FTC Sim',
      },
      (err: Error | null) => {
        clearTimeout(timeout);
        resolve(!err);
      },
    );
  });
}

export async function prepareInternetHost(matchPort: number): Promise<PrepareInternetHostResult> {
  const notes: string[] = [];
  const localIp = lanIpv4();
  const lan = lanAddress(matchPort);

  const fw = ensureWindowsFirewall(matchPort);
  notes.push(fw.note);

  let upnpOk = false;
  if (localIp !== '127.0.0.1') {
    upnpOk = await mapUpnpPort(matchPort, localIp);
    notes.push(
      upnpOk
        ? 'Router: UPnP port mapping OK (TCP ' + matchPort + ')'
        : 'Router: UPnP failed — forward TCP ' + matchPort + ' → ' + localIp + ' manually if friends cannot join',
    );
  } else {
    notes.push('Router: no LAN IP detected for UPnP');
  }

  const publicIp = await fetchPublicIp();
  const inviteAddress =
    suggestedInternetAddress(publicIp, matchPort) ?? lan;

  writeHostSettings({ internetAddress: inviteAddress });
  notes.push('Invite address: ' + inviteAddress);

  return {
    inviteAddress,
    lanAddress: lan,
    publicIp,
    firewallOk: fw.ok,
    upnpOk,
    notes,
  };
}

/** Best-effort release UPnP mapping on quit. */
export function unmapUpnpPort(matchPort: number): void {
  if (!upnpClient) return;
  upnpClient.portUnmapping({ public: matchPort, private: matchPort }, () => {});
  upnpClient.close();
  upnpClient = null;
}
