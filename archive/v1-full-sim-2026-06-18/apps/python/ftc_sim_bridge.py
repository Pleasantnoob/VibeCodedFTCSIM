#!/usr/bin/env python3
"""Python bridge for FTC Neural Simulator — batch runs and NPZ export."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore


def run_cli_batch(episodes: int, duration: float, seed: int, output_dir: Path) -> None:
    """Invoke the Node.js headless CLI for batch simulation."""
    cli = Path(__file__).resolve().parents[2] / "apps" / "cli" / "dist" / "index.js"
    if not cli.exists():
        raise FileNotFoundError(
            f"CLI not built. Run: pnpm --filter @ftc-sim/cli build\nMissing: {cli}"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "node",
        str(cli),
        "--episodes",
        str(episodes),
        "--duration",
        str(duration),
        "--seed",
        str(seed),
        "--output",
        str(output_dir),
        "--format",
        "json",
    ]
    subprocess.run(cmd, check=True)


def json_to_npz(json_path: Path, npz_path: Path) -> None:
    """Convert telemetry JSON recording to NPZ for ML pipelines."""
    if np is None:
        raise ImportError("numpy required for NPZ export: pip install numpy")

    with open(json_path) as f:
        data = json.load(f)

    frames = data["frames"]
    if not frames:
        raise ValueError(f"No frames in {json_path}")

    t = np.array([fr["t"] for fr in frames], dtype=np.float64)
    pose_x = np.array([fr["pose"]["x"] for fr in frames], dtype=np.float64)
    pose_y = np.array([fr["pose"]["y"] for fr in frames], dtype=np.float64)
    pose_h = np.array([fr["pose"]["heading"] for fr in frames], dtype=np.float64)
    truth_x = np.array([fr["poseTruth"]["x"] for fr in frames], dtype=np.float64)
    truth_y = np.array([fr["poseTruth"]["y"] for fr in frames], dtype=np.float64)
    truth_h = np.array([fr["poseTruth"]["heading"] for fr in frames], dtype=np.float64)
    vel_x = np.array([fr["velocity"]["x"] for fr in frames], dtype=np.float64)
    vel_y = np.array([fr["velocity"]["y"] for fr in frames], dtype=np.float64)
    err_trans = np.array([fr["followerError"]["translational"] for fr in frames], dtype=np.float64)
    err_head = np.array([fr["followerError"]["heading"] for fr in frames], dtype=np.float64)
    path_prog = np.array([fr["pathProgress"]["completion"] for fr in frames], dtype=np.float64)
    battery = np.array([fr["batteryVoltage"] for fr in frames], dtype=np.float64)

    np.savez(
        npz_path,
        t=t,
        pose_x=pose_x,
        pose_y=pose_y,
        pose_heading=pose_h,
        truth_x=truth_x,
        truth_y=truth_y,
        truth_heading=truth_h,
        velocity_x=vel_x,
        velocity_y=vel_y,
        error_translational=err_trans,
        error_heading=err_head,
        path_completion=path_prog,
        battery_voltage=battery,
        metadata=json.dumps(data.get("metadata", {})),
    )
    print(f"Wrote {npz_path}")


def batch_and_export(args: argparse.Namespace) -> None:
    output = Path(args.output)
    run_cli_batch(args.episodes, args.duration, args.seed, output)

    if args.npz and np is None:
        print("Warning: numpy not installed, skipping NPZ export", file=sys.stderr)
        return

    if args.npz:
        for i in range(args.episodes):
            json_path = output / f"episode_{i}.json"
            npz_path = output / f"episode_{i}.npz"
            if json_path.exists():
                json_to_npz(json_path, npz_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="FTC Simulator Python bridge")
    sub = parser.add_subparsers(dest="command")

    batch = sub.add_parser("batch", help="Run batch simulations via Node CLI")
    batch.add_argument("--episodes", type=int, default=10)
    batch.add_argument("--duration", type=float, default=15)
    batch.add_argument("--seed", type=int, default=42)
    batch.add_argument("--output", default="./datasets")
    batch.add_argument("--npz", action="store_true", help="Also export NPZ files")
    batch.set_defaults(func=batch_and_export)

    convert = sub.add_parser("convert", help="Convert telemetry JSON to NPZ")
    convert.add_argument("json_file")
    convert.add_argument("-o", "--output", help="Output NPZ path")
    convert.add_argument(
        "func",
        nargs="?",
        default=None,
        help=argparse.SUPPRESS,
    )

    def convert_fn(a: argparse.Namespace) -> None:
        jp = Path(a.json_file)
        op = Path(a.output) if a.output else jp.with_suffix(".npz")
        json_to_npz(jp, op)

    convert.set_defaults(func=convert_fn)

    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()
