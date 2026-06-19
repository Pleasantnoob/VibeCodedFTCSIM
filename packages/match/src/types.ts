export type MatchPhase = 'setup' | 'init' | 'auto' | 'transition' | 'teleop' | 'post';

export type ControlSource = 'none' | 'autonomous' | 'human';

export interface MatchTiming {
  autoSec: number;
  transitionSec: number;
  teleopSec: number;
}

export interface MatchSnapshot {
  phase: MatchPhase;
  timeElapsed: number;
  timeRemainingInPhase: number;
  running: boolean;
  paused: boolean;
  allowsDrive: boolean;
  controlSource: ControlSource;
  infiniteMode: boolean;
}
