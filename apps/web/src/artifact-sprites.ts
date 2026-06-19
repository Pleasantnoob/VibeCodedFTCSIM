import type { ArtifactColor } from '@ftc-sim/field';
import greenArtifactUrl from './assets/green-artifact.webp';
import purpleArtifactUrl from './assets/purple-artifact.webp';

/** Vite-bundled artifact sprites (avoids stale public/ asset cache in dev). */
export const BUNDLED_ARTIFACT_SPRITES: Record<ArtifactColor, string> = {
  purple: purpleArtifactUrl,
  green: greenArtifactUrl,
};
