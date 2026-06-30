const RUMBLE_PULSE_MS = 90;
const RUMBLE_WEAK = 0.45;
const RUMBLE_STRONG = 0.2;

let nextPulseAt = 0;

/** Light pulse rumble while RT / shoot is held (PS4 / Xbox via Gamepad Haptics API). */
export function tickShootRumble(pad: Gamepad | null, shooting: boolean): void {
  const actuator = pad?.vibrationActuator;
  if (!actuator || typeof actuator.playEffect !== 'function') {
    nextPulseAt = 0;
    return;
  }

  if (!shooting) {
    nextPulseAt = 0;
    return;
  }

  const now = performance.now();
  if (now < nextPulseAt) return;
  nextPulseAt = now + RUMBLE_PULSE_MS;

  void actuator
    .playEffect('dual-rumble', {
      duration: RUMBLE_PULSE_MS,
      weakMagnitude: RUMBLE_WEAK,
      strongMagnitude: RUMBLE_STRONG,
    } as GamepadEffectParameters)
    .catch(() => {
      /* Gamepad may not support rumble in this browser / pad mode */
    });
}
