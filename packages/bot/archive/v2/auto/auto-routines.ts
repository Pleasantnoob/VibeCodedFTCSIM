import type { Pose } from '@ftc-sim/field';
import type { Alliance } from '@ftc-sim/game-decode';
import { BezierLine, PathBuilder, PedroFollower, type PathChain } from '@ftc-sim/pedro';
import type { HolonomicInput, KinematicLimits } from '@ftc-sim/robot';

export interface AutoRoutine {
  alliance: Alliance;
  robotSlot: 'near' | 'far';
  waypoints: Array<{ x: number; y: number; heading: number }>;
}

const BLUE_NEAR_AUTO: AutoRoutine = {
  alliance: 'blue',
  robotSlot: 'near',
  waypoints: [
    { x: 22, y: 118, heading: Math.PI / 2 },
    { x: 30, y: 78, heading: 0 },
    { x: 40, y: 110, heading: Math.PI / 4 },
  ],
};

const RED_FAR_AUTO: AutoRoutine = {
  alliance: 'red',
  robotSlot: 'far',
  waypoints: [
    { x: 122, y: 118, heading: Math.PI / 2 },
    { x: 114, y: 78, heading: Math.PI },
    { x: 104, y: 110, heading: (3 * Math.PI) / 4 },
  ],
};

export const AUTO_ROUTINES: AutoRoutine[] = [BLUE_NEAR_AUTO, RED_FAR_AUTO];

function chainFromRoutine(routine: AutoRoutine): PathChain | null {
  if (routine.waypoints.length < 2) return null;
  const builder = new PathBuilder();
  for (let i = 0; i < routine.waypoints.length - 1; i++) {
    const a = routine.waypoints[i]!;
    const b = routine.waypoints[i + 1]!;
    builder.addPath(new BezierLine(a, b));
  }
  return builder.build();
}

export function routineForRobot(robotId: string, alliance: Alliance): AutoRoutine | null {
  if (robotId === 'blue-near' && alliance === 'blue') return BLUE_NEAR_AUTO;
  if (robotId === 'red-far' && alliance === 'red') return RED_FAR_AUTO;
  if (robotId === 'red-near' && alliance === 'red') return RED_FAR_AUTO;
  return null;
}

export class AutoRoutineRunner {
  private follower = new PedroFollower();
  private chain: PathChain | null = null;

  start(routine: AutoRoutine): void {
    this.chain = chainFromRoutine(routine);
    if (this.chain) this.follower.followPath(this.chain);
  }

  isRunning(): boolean {
    return this.follower.isBusy();
  }

  update(pose: Pose, linear: { x: number; y: number }, dt: number, limits: KinematicLimits): HolonomicInput {
    this.follower.setPose(pose);
    this.follower.setVelocity(linear);
    if (!this.chain || !this.follower.isBusy()) {
      return { forward: 0, strafe: 0, turn: 0, brake: true };
    }
    return this.follower.updateHolonomic(dt, limits);
  }

  reset(): void {
    this.chain = null;
    this.follower.cancelPath();
  }
}
