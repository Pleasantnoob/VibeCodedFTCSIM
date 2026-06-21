import type { BotDriveSample, BotSlotConfig, BotWorldSnapshot } from '@ftc-sim/bot';
import type { DriveSample } from './drive-resolver.js';

export {
  allianceForRobotId,
  buildBotWorldSnapshot,
  buildBotWorldSnapshotFromParts,
  buildBotWorldSnapshotFromWebContext,
  type BotWebSnapshotContext,
} from './bot-adapter.js';

export function botSampleToDriveSample(sample: BotDriveSample): DriveSample {
  return {
    input: { ...sample.input },
    driveFrame: sample.driveFrame,
    mechanism: {
      command: { ...sample.mechanism.command },
      shootEdge: sample.mechanism.shootEdge,
      gateEdge: sample.mechanism.gateEdge,
      shootHeld: sample.mechanism.shootHeld,
    },
  };
}

export type { BotWorldSnapshot, BotSlotConfig };
