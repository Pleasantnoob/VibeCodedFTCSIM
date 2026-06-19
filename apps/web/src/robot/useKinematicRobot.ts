import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Pose, Vector2 } from '@ftc-sim/field';
import {
  DEFAULT_KINEMATIC_ROBOT,
  holonomicToWorldVelocity,
  integrateKinematicRobot,
  isHolonomicActive,
  type HolonomicInput,
  type KinematicRobotConfig,
} from '@ftc-sim/robot';

const FIXED_DT = 1 / 120;

export function useKinematicRobot(
  startPose: Pose,
  inputRef: RefObject<HolonomicInput>,
  barriers: Vector2[][],
  enabled: boolean,
  config: KinematicRobotConfig = DEFAULT_KINEMATIC_ROBOT,
) {
  const poseRef = useRef(startPose);
  const barriersRef = useRef(barriers);
  const [pose, setPose] = useState(startPose);
  const [speed, setSpeed] = useState(0);

  barriersRef.current = barriers;

  const reset = useCallback(() => {
    poseRef.current = startPose;
    setPose(startPose);
    setSpeed(0);
  }, [startPose]);

  useEffect(() => {
    poseRef.current = startPose;
    setPose(startPose);
    setSpeed(0);
  }, [startPose]);

  useEffect(() => {
    if (!enabled) return;

    let frame = 0;
    let last = performance.now();
    let accumulator = 0;

    const tick = (now: number) => {
      const frameDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      accumulator += frameDt;

      const input = inputRef.current ?? { forward: 0, strafe: 0, turn: 0 };

      while (accumulator >= FIXED_DT) {
        if (isHolonomicActive(input)) {
          poseRef.current = integrateKinematicRobot(
            poseRef.current,
            input,
            FIXED_DT,
            config.limits,
            barriersRef.current,
            config.footprint,
            config.driveFrame ?? 'field',
          );
        }
        accumulator -= FIXED_DT;
      }

      const currentPose = poseRef.current;
      setPose({
        x: currentPose.x,
        y: currentPose.y,
        heading: currentPose.heading,
      });

      if (isHolonomicActive(input)) {
        const velocity = holonomicToWorldVelocity(
          input,
          currentPose.heading,
          config.limits,
          config.driveFrame ?? 'field',
        );
        setSpeed(Math.hypot(velocity.vx, velocity.vy));
      } else {
        setSpeed(0);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, startPose, config, inputRef]);

  return {
    pose,
    speed,
    reset,
  };
}
