export type RobotSkinId = 'transparent' | 'tournament-design';

export interface RobotSkinDefinition {
  id: RobotSkinId;
  label: string;
  imageUrl?: string;
}

export const ROBOT_SKIN_OPTIONS: RobotSkinDefinition[] = [
  { id: 'transparent', label: 'Transparent' },
  {
    id: 'tournament-design',
    label: 'Tournament design',
    imageUrl: '/robots/tournament-design.png',
  },
];

export const DEFAULT_ROBOT_SKIN_ID: RobotSkinId = 'transparent';

export function parseRobotSkinId(value: unknown): RobotSkinId {
  if (value === 'tournament-design') return 'tournament-design';
  return 'transparent';
}

export function robotSkinById(id: RobotSkinId): RobotSkinDefinition {
  return ROBOT_SKIN_OPTIONS.find((skin) => skin.id === id) ?? ROBOT_SKIN_OPTIONS[0]!;
}
