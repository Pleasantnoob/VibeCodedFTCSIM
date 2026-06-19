#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  exportToCsv,
  exportToJsonString,
  getDecodeField,
  parsePedroJson,
  SimulationEngine,
  type PedroJsonFile,
} from '@ftc-sim/core';

const DEFAULT_PATH: PedroJsonFile = {
  version: '1.0',
  coordinateSystem: 'pedro',
  paths: [
    {
      type: 'BezierLine',
      startPoint: { x: 9, y: 117 },
      endPoint: { x: 72, y: 72 },
      headingInterpolation: { mode: 'linear', startHeading: 0, endHeading: 1.57, endTime: 0.8 },
    },
  ],
};

interface CliOptions {
  episodes: number;
  duration: number;
  seed: number;
  outputDir: string;
  format: 'csv' | 'json' | 'both';
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    episodes: 1,
    duration: 15,
    seed: 42,
    outputDir: './output',
    format: 'both',
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--episodes':
        opts.episodes = Number(args[++i]);
        break;
      case '--duration':
        opts.duration = Number(args[++i]);
        break;
      case '--seed':
        opts.seed = Number(args[++i]);
        break;
      case '--output':
        opts.outputDir = args[++i];
        break;
      case '--format':
        opts.format = args[++i] as CliOptions['format'];
        break;
    }
  }
  return opts;
}

async function runEpisode(episodeIndex: number, opts: CliOptions): Promise<void> {
  const engine = new SimulationEngine();
  const seed = opts.seed + episodeIndex;
  engine.loadScenario({
    field: 'decode',
    robots: [{ id: 'robot1', pose: getDecodeField().startPoses.red_near }],
    gamePieces: [{ pieceId: 'artifact', pose: { x: 10, y: 80, heading: 0 }, count: 2 }],
    duration: opts.duration,
    seed,
  });
  await engine.reset(seed);
  engine.loadPathFromJson('robot1', DEFAULT_PATH);
  engine.startPath('robot1');
  engine.startRecording();
  engine.start();

  while (engine.getState().running) {
    engine.update();
  }

  const recording = engine.getRecording();
  mkdirSync(opts.outputDir, { recursive: true });
  const prefix = resolve(opts.outputDir, `episode_${episodeIndex}`);

  if (opts.format === 'csv' || opts.format === 'both') {
    writeFileSync(`${prefix}.csv`, exportToCsv(recording));
  }
  if (opts.format === 'json' || opts.format === 'both') {
    writeFileSync(`${prefix}.json`, exportToJsonString(recording));
  }

  console.log(`Episode ${episodeIndex} complete: ${recording.frames.length} frames → ${prefix}`);
}

async function main(): Promise<void> {
  const opts = parseArgs();
  console.log(`FTC Sim CLI — ${opts.episodes} episode(s), ${opts.duration}s each, seed=${opts.seed}`);
  for (let i = 0; i < opts.episodes; i++) {
    await runEpisode(i, opts);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
