import { useEffect, useRef, type RefObject } from 'react';
import type { Pose } from '@ftc-sim/field';
import { getBarrierBodies, getBodyOutline } from '@ftc-sim/field';
import { getDecodeField } from '@ftc-sim/season-decode';
import {
  DEFAULT_SIM_ROBOT_CONFIG,
  simRobotFootprint,
  simRobotLimits,
  type SimRobotConfig,
} from '@ftc-sim/session';
import type { DriveFrame } from '@ftc-sim/robot';
import { stepVelocityDrive } from '@ftc-sim/robot';
import { shouldSnapPose, smoothPose } from './smooth-motion';

const FIELD = getDecodeField();
const BARRIER_POLYS = getBarrierBodies(FIELD).map((body) =>
  getBodyOutline(body).map((v) => ({ x: v.x, y: v.y })),
);
const PHYSICS_DT = 1 / 120;

export type DriveSampleInput = () => {
  input: {
    forward: number;
    strafe: number;
    turn: number;
    brake?: boolean;
    endpointBrake?: boolean;
  };
};

export function useOwnedRobotPrediction(options: {
  enabled: boolean;
  robotId: string | null;
  allowsDrive: boolean;
  robotConfig?: SimRobotConfig;
  sampleInputRef: RefObject<DriveSampleInput | null>;
  driveFrameRef: RefObject<DriveFrame>;
  authoritativePose: Pose | null;
  snapshotTick: number;
}): RefObject<Pose | null> {
  const {
    enabled,
    robotId,
    allowsDrive,
    robotConfig = DEFAULT_SIM_ROBOT_CONFIG,
    sampleInputRef,
    driveFrameRef,
    authoritativePose,
    snapshotTick,
  } = options;

  const poseRef = useRef<Pose | null>(null);
  const motionRef = useRef({
    pose: { x: 0, y: 0, heading: 0 } as Pose,
    linear: { x: 0, y: 0 },
    angular: 0,
  });
  const lastSnapshotTickRef = useRef(snapshotTick);
  const robotConfigRef = useRef(robotConfig);
  robotConfigRef.current = robotConfig;

  useEffect(() => {
    if (lastSnapshotTickRef.current !== snapshotTick) {
      lastSnapshotTickRef.current = snapshotTick;
      poseRef.current = null;
    }
    if (!authoritativePose) return;

    const motion = motionRef.current;
    if (!poseRef.current) {
      motion.pose = { ...authoritativePose };
      motion.linear = { x: 0, y: 0 };
      motion.angular = 0;
      poseRef.current = { ...authoritativePose };
      return;
    }

    if (shouldSnapPose(motion.pose, authoritativePose)) {
      motion.pose = { ...authoritativePose };
      motion.linear = { x: 0, y: 0 };
      motion.angular = 0;
    } else {
      motion.pose = smoothPose(motion.pose, authoritativePose, 0.4);
    }
    poseRef.current = { ...motion.pose };
  }, [authoritativePose, snapshotTick]);

  useEffect(() => {
    if (!enabled || !robotId || !allowsDrive) {
      if (!enabled) poseRef.current = null;
      return;
    }

    let frame = 0;
    let lastNow = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(PHYSICS_DT * 4, Math.max(PHYSICS_DT, (now - lastNow) / 1000));
      lastNow = now;

      const sample = sampleInputRef.current?.();
      if (!sample) {
        frame = requestAnimationFrame(loop);
        return;
      }

      const config = robotConfigRef.current;
      const limits = simRobotLimits(config);
      const footprint = simRobotFootprint(config);
      const motion = motionRef.current;
      const stepped = stepVelocityDrive({
        pose: motion.pose,
        linear: motion.linear,
        angular: motion.angular,
        input: sample.input,
        dt,
        limits,
        footprint,
        barriers: BARRIER_POLYS,
        fieldSizeInches: FIELD.fieldSizeInches ?? 144,
        driveFrame: driveFrameRef.current,
        maxAcceleration: config.maxAcceleration,
        maxAngularAcceleration: config.maxAngularAcceleration,
      });

      motion.pose = stepped.pose;
      motion.linear = stepped.linear;
      motion.angular = stepped.angular;
      poseRef.current = { ...stepped.pose };

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [enabled, robotId, allowsDrive, sampleInputRef, driveFrameRef, robotConfig]);

  return poseRef;
}
