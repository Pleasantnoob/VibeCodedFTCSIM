import type { AutoSequence } from './auto-sequence.js';
import type { PathChain } from './paths.js';
import { findSegmentGaps, parsePedroJson, type PedroJsonFile } from './path-io.js';
import { parseVisualizerAutoSequence, parseVisualizerPp, type VisualizerPpFile } from './pp-io.js';

export type PathFileFormat = 'pedro-json' | 'visualizer-pp';

export interface ParsedPathFile {
  format: PathFileFormat;
  chain: PathChain;
  warnings: string[];
  autoSequence?: AutoSequence;
}

function isPedroJson(data: unknown): data is PedroJsonFile {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.paths) || (obj.pathChain != null && typeof obj.pathChain === 'object');
}

function isVisualizerPp(data: unknown): data is VisualizerPpFile {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return obj.startPoint != null && Array.isArray(obj.lines);
}

export function parsePathFile(data: unknown): ParsedPathFile {
  if (isPedroJson(data)) {
    const warnings = findSegmentGaps(data);
    return {
      format: 'pedro-json',
      chain: parsePedroJson(data),
      warnings,
    };
  }
  if (isVisualizerPp(data)) {
    const autoSequence = parseVisualizerAutoSequence(data);
    return {
      format: 'visualizer-pp',
      chain: autoSequence.displayChain,
      warnings: [],
      autoSequence,
    };
  }
  throw new Error('Unknown path file format: expected PedroJSON (paths[]) or Visualizer .pp (startPoint + lines[])');
}

export function parsePathFileText(text: string): ParsedPathFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON in path file');
  }
  return parsePathFile(parsed);
}
