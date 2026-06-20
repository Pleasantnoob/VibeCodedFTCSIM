import type { Pose } from '@ftc-sim/field';

export type ArtifactColor = 'purple' | 'green';

export interface StagedArtifactLayout {
  id: string;
  color: ArtifactColor;
  pose: Pose;
  source: string;
}

export const FIELD_SIZE_INCHES = 144;
export const ARTIFACT_SPACING = 5;

/** Blue tile seam W (A|B boundary). Red mirrors at 144 - 24. */
export const BLUE_SPIKE_SEAM_X = 24;
export const RED_SPIKE_SEAM_X = FIELD_SIZE_INCHES - BLUE_SPIKE_SEAM_X;

export const SPIKE_ROW_Y = [36, 60, 84] as const;

/** West → east color patterns per row (y = 36, 60, 84). */
export const BLUE_SPIKE_COLORS: Record<number, [ArtifactColor, ArtifactColor, ArtifactColor]> = {
  36: ['purple', 'purple', 'green'],
  60: ['purple', 'green', 'purple'],
  84: ['green', 'purple', 'purple'],
};

/** Red spikes mirror spatial order (east → west reads as reversed W→E). */
export const RED_SPIKE_COLORS: Record<number, [ArtifactColor, ArtifactColor, ArtifactColor]> = {
  36: ['green', 'purple', 'purple'],
  60: ['purple', 'green', 'purple'],
  84: ['purple', 'purple', 'green'],
};

const HUMAN_PLAYER_COLORS: [ArtifactColor, ArtifactColor, ArtifactColor] = [
  'purple',
  'green',
  'purple',
];

function horizontalSpike(
  centerX: number,
  y: number,
  colors: [ArtifactColor, ArtifactColor, ArtifactColor],
  source: string,
  idStart: number,
): StagedArtifactLayout[] {
  const xs = [centerX - ARTIFACT_SPACING, centerX, centerX + ARTIFACT_SPACING];
  return colors.map((color, i) => ({
    id: `artifact_${idStart + i}`,
    color,
    pose: { x: xs[i]!, y, heading: 0 },
    source,
  }));
}

/** Full match: 18 spike + 3 station + 6 reserve per alliance (36 total). */
export function getMatchArtifactStaging(): StagedArtifactLayout[] {
  const out: StagedArtifactLayout[] = [];
  let id = 0;

  for (const y of SPIKE_ROW_Y) {
    out.push(
      ...horizontalSpike(
        BLUE_SPIKE_SEAM_X,
        y,
        BLUE_SPIKE_COLORS[y],
        `blue_spike_y${y}`,
        id,
      ),
    );
    id += 3;
  }

  for (const y of SPIKE_ROW_Y) {
    out.push(
      ...horizontalSpike(
        RED_SPIKE_SEAM_X,
        y,
        RED_SPIKE_COLORS[y],
        `red_spike_y${y}`,
        id,
      ),
    );
    id += 3;
  }

  out.push(...humanPlayerStation('blue', id));
  id += 3;
  out.push(...humanPlayerReserve('blue', id));
  id += 6;
  out.push(...humanPlayerStation('red', id));
  id += 3;
  out.push(...humanPlayerReserve('red', id));

  return out;
}

/** Three balls in the human-player loading zone (always visible; teleop feed). */
function humanPlayerStation(alliance: 'blue' | 'red', idStart: number): StagedArtifactLayout[] {
  const x = alliance === 'blue' ? 5 : FIELD_SIZE_INCHES - 5;
  const ys = [5, 10, 15];
  return HUMAN_PLAYER_COLORS.map((color, i) => ({
    id: `artifact_${idStart + i}`,
    color,
    pose: { x, y: ys[i]!, heading: 0 },
    source: `${alliance}_human_player_station`,
  }));
}

/** Six balls outside the field with the human player (preload + teleop feed). */
function humanPlayerReserve(alliance: 'blue' | 'red', idStart: number): StagedArtifactLayout[] {
  const xs = alliance === 'blue' ? [2, 8] : [FIELD_SIZE_INCHES - 2, FIELD_SIZE_INCHES - 8];
  const ys = [4, 10, 16];
  const out: StagedArtifactLayout[] = [];
  let id = idStart;
  for (const x of xs) {
    for (let i = 0; i < HUMAN_PLAYER_COLORS.length; i++) {
      out.push({
        id: `artifact_${id++}`,
        color: HUMAN_PLAYER_COLORS[i]!,
        pose: { x, y: ys[i]!, heading: 0 },
        source: `${alliance}_human_player_reserve`,
      });
    }
  }
  return out;
}
