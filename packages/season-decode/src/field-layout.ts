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

function verticalSpike(
  x: number,
  centerY: number,
  colors: [ArtifactColor, ArtifactColor, ArtifactColor],
  source: string,
  idStart: number,
): StagedArtifactLayout[] {
  const ys = [centerY - ARTIFACT_SPACING, centerY, centerY + ARTIFACT_SPACING];
  return colors.map((color, i) => ({
    id: `artifact_${idStart + i}`,
    color,
    pose: { x, y: ys[i]!, heading: 0 },
    source,
  }));
}

/** Full match artifact staging: 24 on-field pieces (no preloads). */
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

  out.push(...verticalSpike(5, 10, HUMAN_PLAYER_COLORS, 'blue_human_player', id));
  id += 3;
  out.push(...verticalSpike(FIELD_SIZE_INCHES - 5, 10, HUMAN_PLAYER_COLORS, 'red_human_player', id));

  return out;
}
