import type { DecodeRulesConfig } from './types.js';
import rulesJson from '../rules.json' with { type: 'json' };

export const DECODE_RULES: DecodeRulesConfig = rulesJson as DecodeRulesConfig;

export function getDecodeRules(): DecodeRulesConfig {
  return DECODE_RULES;
}

export function validateRules(config: DecodeRulesConfig = DECODE_RULES): void {
  const expected = {
    leave: 3,
    classified: 3,
    overflow: 1,
    depot: 1,
    patternPerArtifact: 2,
    basePartial: 5,
    baseFull: 10,
    allianceBothFullBase: 10,
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = config.scoring[key as keyof typeof expected];
    if (actual !== value) {
      throw new Error(`Rules validation failed: scoring.${key} expected ${value}, got ${actual}`);
    }
  }
  if (config.artifactDiameterInches !== 5) {
    throw new Error(`Expected artifact diameter 5 in, got ${config.artifactDiameterInches}`);
  }
  if (config.matchTiming.autoSec !== 30 || config.matchTiming.teleopSec !== 120) {
    throw new Error('Match timing must be 30s AUTO and 120s TELEOP per manual');
  }
}
