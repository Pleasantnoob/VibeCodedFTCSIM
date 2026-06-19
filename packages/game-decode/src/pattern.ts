import { getDecodeRules } from './rules-loader.js';
import type { Alliance, ArtifactColor, MatchState, ObeliskMotifId } from './types.js';

/** Individual artifact slots that match the obelisk motif (0–9). Used for scoring. */
export function countPatternMatchesForAlliance(
  rampOccupancy: (ArtifactColor | null)[],
  motifId: ObeliskMotifId,
): number {
  const rules = getDecodeRules();
  const motif = rules.motifs[motifId];
  const patternColors: ArtifactColor[] = [];
  for (let i = 0; i < 3; i++) patternColors.push(...motif);
  let matches = 0;
  for (let i = 0; i < rules.rampSlots; i++) {
    if (rampOccupancy[i] && rampOccupancy[i] === patternColors[i]) matches += 1;
  }
  return matches;
}

/** Complete GPP/PGP/PPG triplets on the ramp (0–3). Used for broadcast HUD. */
export function countCompletePatternGroups(
  rampOccupancy: (ArtifactColor | null)[],
  motifId: ObeliskMotifId,
): number {
  const motif = getDecodeRules().motifs[motifId];
  let groups = 0;
  for (let group = 0; group < 3; group++) {
    let complete = true;
    for (let j = 0; j < 3; j++) {
      const idx = group * 3 + j;
      if (rampOccupancy[idx] !== motif[j]) {
        complete = false;
        break;
      }
    }
    if (complete) groups += 1;
  }
  return groups;
}

export function countPatternMatchesFromState(state: MatchState, alliance: Alliance): number {
  return countPatternMatchesForAlliance(state.rampOccupancy[alliance], state.obeliskMotif);
}

export function countPatternGroupsFromState(state: MatchState, alliance: Alliance): number {
  return countCompletePatternGroups(state.rampOccupancy[alliance], state.obeliskMotif);
}
