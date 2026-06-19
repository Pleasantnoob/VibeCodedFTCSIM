export interface Vector2 {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

export interface MaterialProperties {
  friction: number;
  restitution?: number;
  density?: number;
}

export interface FieldBodyDefinition {
  id: string;
  type: 'static' | 'dynamic';
  shape: 'polygon' | 'rectangle' | 'circle';
  vertices?: Vector2[];
  center?: Vector2;
  width?: number;
  height?: number;
  radius?: number;
  material: MaterialProperties;
  mass?: number;
  label?: string;
}

export interface FieldZoneDefinition {
  id: string;
  type: string;
  polygon: Vector2[];
  alliance?: 'red' | 'blue' | 'neutral';
  label?: string;
  points?: number;
  capacity?: number;
}

export interface GamePieceDefinition {
  id: string;
  type: string;
  shape: 'circle' | 'rectangle';
  radius?: number;
  width?: number;
  height?: number;
  mass: number;
  material: MaterialProperties;
  spawnZones?: string[];
}

export interface FieldDefinition {
  season: string;
  version: string;
  fieldSizeInches: number;
  visualFieldSizeInches?: number;
  coordinateSystem: 'pedro' | 'ftc';
  visualAssets?: {
    fieldImage?: string;
    robotImage?: string;
    artifactSprites?: { purple?: string; green?: string };
  };
  bodies: FieldBodyDefinition[];
  zones: FieldZoneDefinition[];
  startPoses: Record<string, Pose>;
  gamePieces: GamePieceDefinition[];
}

export type ArtifactColor = 'purple' | 'green';

export interface StagedArtifactLayout {
  id: string;
  color: ArtifactColor;
  pose: Pose;
  source: string;
}
