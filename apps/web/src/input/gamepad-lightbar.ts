/**
 * PS4 / DualShock 4 light bar via WebHID (Chrome / Edge).
 * Report layout matches Pecacheu dualshock / Linux hid-playstation DS4 output.
 */

const SONY_VENDOR_ID = 0x054c;
const DS4_PRODUCT_IDS = new Set([0x05c4, 0x09cc, 0x0ba0]);
/** Windows WebHID DS4 vendor interface: 31 data bytes + report id 0x05 (32 total). */
const DS4_USB_OUTPUT_LEN = 31;

export type GamepadAlliance = 'blue' | 'red';

const ALLIANCE_RGB: Record<GamepadAlliance, [number, number, number]> = {
  blue: [0x3b, 0x82, 0xf6],
  red: [0xef, 0x44, 0x44],
};

interface HidReportInfo {
  reportId: number;
}

interface HidCollectionInfo {
  outputReports?: HidReportInfo[];
}

interface HidDeviceLike {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName?: string;
  collections?: HidCollectionInfo[];
  open(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

interface HidNavigatorLike extends Navigator {
  hid?: {
    getDevices(): Promise<HidDeviceLike[]>;
    requestDevice(options: {
      filters: Array<{ vendorId: number; productId?: number }>;
    }): Promise<HidDeviceLike[]>;
  };
}

const hidNavigator = navigator as HidNavigatorLike;

let cachedDevice: HidDeviceLike | null = null;
let lastAlliance: GamepadAlliance | null = null;
let lastRgb: [number, number, number] | null = null;

function isSonyPad(device: HidDeviceLike): boolean {
  return device.vendorId === SONY_VENDOR_ID && DS4_PRODUCT_IDS.has(device.productId);
}

function hasOutputReport(device: HidDeviceLike, reportId: number): boolean {
  return (
    device.collections?.some((collection) =>
      collection.outputReports?.some((report) => report.reportId === reportId),
    ) ?? false
  );
}

function crc32Le(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return ~crc >>> 0;
}

async function openDevice(device: HidDeviceLike): Promise<boolean> {
  try {
    if (!device.opened) await device.open();
    return true;
  } catch {
    return false;
  }
}

function isUsbDs4Interface(device: HidDeviceLike): boolean {
  if (hasOutputReport(device, 0x05)) return true;
  if (hasOutputReport(device, 0x11)) return false;
  // Chrome often omits collections until open; USB pads use the 32-byte vendor interface.
  return true;
}

async function pickWritableDs4(devices: HidDeviceLike[], probe = false): Promise<HidDeviceLike | null> {
  const candidates = devices.filter(isSonyPad);
  const ordered = [
    ...candidates.filter((device) => hasOutputReport(device, 0x05)),
    ...candidates.filter((device) => hasOutputReport(device, 0x11)),
    ...candidates,
  ];
  const seen = new Set<HidDeviceLike>();
  for (const device of ordered) {
    if (seen.has(device)) continue;
    seen.add(device);
    if (!(await openDevice(device))) continue;
    if (!probe) return device;
    const rgb = lastRgb ?? ALLIANCE_RGB.blue;
    try {
      if (isUsbDs4Interface(device)) {
        await sendUsbLightbar(device, rgb);
      } else {
        await sendBtLightbar(device, rgb);
      }
      return device;
    } catch {
      /* try next interface */
    }
  }
  return null;
}

async function sendUsbLightbar(
  device: HidDeviceLike,
  rgb: [number, number, number],
  rumbleRight = 0,
  rumbleLeft = 0,
): Promise<void> {
  const [red, green, blue] = rgb;
  const payload = new Uint8Array(DS4_USB_OUTPUT_LEN);
  payload[0] = 0xff;
  payload[1] = 0x04;
  payload[2] = 0x00;
  payload[3] = rumbleRight;
  payload[4] = rumbleLeft;
  payload[5] = red;
  payload[6] = green;
  payload[7] = blue;
  await device.sendReport(0x05, payload);
}

async function sendBtLightbar(
  device: HidDeviceLike,
  rgb: [number, number, number],
  rumbleRight = 0,
  rumbleLeft = 0,
): Promise<void> {
  const [red, green, blue] = rgb;
  const msg = new Uint8Array(79);
  msg[0] = 0xa2;
  msg[1] = 0x11;
  msg[2] = 0xc0;
  msg[3] = 0xa0;
  msg[4] = 0xf3;
  msg[5] = 0x04;
  msg[6] = 0x00;
  msg[7] = rumbleRight;
  msg[8] = rumbleLeft;
  msg[9] = red;
  msg[10] = green;
  msg[11] = blue;
  const crc = crc32Le(msg.subarray(0, 75));
  msg[75] = crc & 0xff;
  msg[76] = (crc >>> 8) & 0xff;
  msg[77] = (crc >>> 16) & 0xff;
  msg[78] = (crc >>> 24) & 0xff;
  await device.sendReport(0x11, msg.subarray(1));
}

async function sendLightbar(
  device: HidDeviceLike,
  rgb: [number, number, number],
): Promise<boolean> {
  if (isUsbDs4Interface(device)) {
    try {
      await sendUsbLightbar(device, rgb);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await sendBtLightbar(device, rgb);
    return true;
  } catch {
    return false;
  }
}

/** Re-open a pad the user already granted (no picker). */
export async function ensureDs4HidDevice(): Promise<boolean> {
  if (!hidNavigator.hid) return false;
  if (cachedDevice?.opened) return true;
  const devices = await hidNavigator.hid.getDevices();
  const device = await pickWritableDs4(devices);
  if (!device) return false;
  cachedDevice = device;
  return true;
}

/** Prompt once — must run from a user gesture (click / init button). */
export async function requestDs4HidDevice(): Promise<boolean> {
  if (!hidNavigator.hid) return false;
  try {
    const filters = [
      { vendorId: SONY_VENDOR_ID, productId: 0x05c4, usagePage: 0xff00, usage: 0x21 },
      { vendorId: SONY_VENDOR_ID, productId: 0x09cc, usagePage: 0xff00, usage: 0x21 },
      { vendorId: SONY_VENDOR_ID, productId: 0x0ba0, usagePage: 0xff00, usage: 0x21 },
      { vendorId: SONY_VENDOR_ID, productId: 0x05c4 },
      { vendorId: SONY_VENDOR_ID, productId: 0x09cc },
      { vendorId: SONY_VENDOR_ID, productId: 0x0ba0 },
      { vendorId: SONY_VENDOR_ID },
    ];
    const devices = await hidNavigator.hid.requestDevice({ filters });
    const device = await pickWritableDs4(devices, true);
    if (!device) return false;
    cachedDevice = device;
    return true;
  } catch {
    return false;
  }
}

/** Apply alliance color; re-sends when alliance changes or after reconnect. */
export async function setDs4AllianceLightbar(
  alliance: GamepadAlliance,
  force = false,
): Promise<boolean> {
  if (!hidNavigator.hid) return false;
  const rgb = ALLIANCE_RGB[alliance];
  if (!force && lastAlliance === alliance && lastRgb?.every((v, i) => v === rgb[i])) {
    if (cachedDevice?.opened) return true;
  }

  const trySend = async (device: HidDeviceLike): Promise<boolean> => {
    if (!(await openDevice(device))) return false;
    return sendLightbar(device, rgb);
  };

  if (cachedDevice) {
    try {
      if (await trySend(cachedDevice)) {
        lastAlliance = alliance;
        lastRgb = rgb;
        return true;
      }
    } catch {
      /* fall through */
    }
    cachedDevice = null;
  }

  const devices = await hidNavigator.hid.getDevices();
  const device = await pickWritableDs4(devices, true);
  if (!device) {
    lastAlliance = null;
    lastRgb = null;
    return false;
  }
  try {
    if (await sendLightbar(device, rgb)) {
      cachedDevice = device;
      lastAlliance = alliance;
      lastRgb = rgb;
      return true;
    }
  } catch {
    /* no-op */
  }
  cachedDevice = null;
  lastAlliance = null;
  lastRgb = null;
  return false;
}

/** Call after match INIT — uses prior WebHID grant or no-ops until user clicks once. */
export async function syncGamepadAllianceLight(alliance: GamepadAlliance): Promise<boolean> {
  const ready = cachedDevice?.opened || (await ensureDs4HidDevice());
  if (!ready) return false;
  return setDs4AllianceLightbar(alliance, true);
}

export function clearDs4LightbarCache(): void {
  cachedDevice = null;
  lastAlliance = null;
  lastRgb = null;
}
