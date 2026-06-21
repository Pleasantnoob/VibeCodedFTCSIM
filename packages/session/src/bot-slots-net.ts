import type { BotRobotId, BotSlotConfig } from '@ftc-sim/bot';
import type { NetBotSlotConfig } from '@ftc-sim/net';
import { parsePathFileText } from '@ftc-sim/pedro';

export function botSlotsFromNetConfig(slots: NetBotSlotConfig[]): BotSlotConfig[] {
  let loadId = 1;
  return slots.map((slot) => {
    let autoPath: BotSlotConfig['autoPath'] = null;
    if (slot.autoPathText) {
      const parsed = parsePathFileText(slot.autoPathText);
      autoPath = {
        basePathChain: parsed.chain,
        baseAutoSequence: parsed.autoSequence ?? null,
        label: slot.autoPathLabel ?? 'upload',
        loadId: loadId++,
      };
    }
    return {
      robotId: slot.robotId as BotRobotId,
      enabled: slot.enabled,
      difficulty: slot.difficulty,
      runAuto: slot.runAuto,
      autoPath,
    };
  });
}

export function netConfigFromBotSlots(
  slots: BotSlotConfig[],
  pathTextByRobot: ReadonlyMap<string, string>,
): NetBotSlotConfig[] {
  return slots.map((slot) => ({
    robotId: slot.robotId,
    enabled: slot.enabled,
    difficulty: slot.difficulty,
    runAuto: slot.runAuto,
    autoPathText: slot.autoPath ? (pathTextByRobot.get(slot.robotId) ?? null) : null,
    autoPathLabel: slot.autoPath?.label,
  }));
}
