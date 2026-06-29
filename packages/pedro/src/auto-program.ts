import type { AutoSequence } from './auto-sequence.js';

export type WaitOnTimeout = 'continue' | 'abort';

export interface StoredCountWait {
  kind: 'storedCount';
  min?: number;
  max?: number;
  timeoutSec: number;
  onTimeout: WaitOnTimeout;
}

export interface AutoProgramModuleRef {
  path: string;
}

export type ProgramStep =
  | { run: string }
  | { waitUntil: string }
  | { loop: { body: ProgramStep[]; until: 'leaveBudget' } };

export interface AutoProgramLeaveConfig {
  safetyMarginSec?: number;
}

export interface AutoProgram {
  version: 1;
  modules: Record<string, AutoProgramModuleRef>;
  steps: ProgramStep[];
  waits?: Record<string, StoredCountWait>;
  leave?: AutoProgramLeaveConfig;
}

export interface ResolvedAutoProgram {
  program: AutoProgram;
  moduleSequences: Map<string, AutoSequence>;
}

export const DEFAULT_PROGRAM_WAITS: Record<string, StoredCountWait> = {
  storedFull: {
    kind: 'storedCount',
    min: 3,
    timeoutSec: 2.5,
    onTimeout: 'continue',
  },
  storedEmpty: {
    kind: 'storedCount',
    max: 0,
    timeoutSec: 4.0,
    onTimeout: 'continue',
  },
};

export const DEFAULT_LEAVE_SAFETY_MARGIN_SEC = 2.0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStoredCountWait(raw: unknown, label: string): StoredCountWait {
  if (!isRecord(raw) || raw.kind !== 'storedCount') {
    throw new Error(`Wait "${label}" must be kind storedCount`);
  }
  const timeoutSec = Number(raw.timeoutSec);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    throw new Error(`Wait "${label}" needs positive timeoutSec`);
  }
  const onTimeout = raw.onTimeout === 'abort' ? 'abort' : 'continue';
  const min = raw.min !== undefined ? Number(raw.min) : undefined;
  const max = raw.max !== undefined ? Number(raw.max) : undefined;
  if (min === undefined && max === undefined) {
    throw new Error(`Wait "${label}" needs min or max stored count`);
  }
  return { kind: 'storedCount', min, max, timeoutSec, onTimeout };
}

function parseProgramStep(raw: unknown): ProgramStep {
  if (!isRecord(raw)) throw new Error('Invalid program step');
  if (typeof raw.run === 'string') return { run: raw.run };
  if (typeof raw.waitUntil === 'string') return { waitUntil: raw.waitUntil };
  if (isRecord(raw.loop)) {
    const bodyRaw = raw.loop.body;
    if (!Array.isArray(bodyRaw)) throw new Error('loop.body must be an array');
    const until = raw.loop.until;
    if (until !== 'leaveBudget') throw new Error('loop.until must be leaveBudget');
    return { loop: { body: bodyRaw.map(parseProgramStep), until: 'leaveBudget' } };
  }
  throw new Error('Program step must be run, waitUntil, or loop');
}

export function parseAutoProgram(data: unknown): AutoProgram {
  if (!isRecord(data)) throw new Error('Auto program must be an object');
  if (data.version !== 1) throw new Error('Auto program version must be 1');

  const modulesRaw = data.modules;
  if (!isRecord(modulesRaw)) throw new Error('Auto program modules required');

  const modules: Record<string, AutoProgramModuleRef> = {};
  for (const [id, ref] of Object.entries(modulesRaw)) {
    if (!isRecord(ref) || typeof ref.path !== 'string' || !ref.path.trim()) {
      throw new Error(`Module "${id}" needs a path string`);
    }
    modules[id] = { path: ref.path.trim() };
  }

  const stepsRaw = data.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    throw new Error('Auto program steps must be a non-empty array');
  }
  const steps = stepsRaw.map(parseProgramStep);

  const waits: Record<string, StoredCountWait> = { ...DEFAULT_PROGRAM_WAITS };
  if (data.waits !== undefined) {
    if (!isRecord(data.waits)) throw new Error('waits must be an object');
    for (const [id, spec] of Object.entries(data.waits)) {
      waits[id] = parseStoredCountWait(spec, id);
    }
  }

  let leave: AutoProgramLeaveConfig | undefined;
  if (data.leave !== undefined) {
    if (!isRecord(data.leave)) throw new Error('leave must be an object');
    leave = {
      safetyMarginSec:
        data.leave.safetyMarginSec !== undefined
          ? Number(data.leave.safetyMarginSec)
          : DEFAULT_LEAVE_SAFETY_MARGIN_SEC,
    };
  }

  validateProgramSteps(steps, modules, waits);
  return { version: 1, modules, steps, waits, leave };
}

export function parseAutoProgramText(text: string): AutoProgram {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Auto program JSON parse failed');
  }
  return parseAutoProgram(parsed);
}

function validateProgramSteps(
  steps: ProgramStep[],
  modules: Record<string, AutoProgramModuleRef>,
  waits: Record<string, StoredCountWait>,
): void {
  const walk = (list: ProgramStep[], inLoop: boolean) => {
    for (const step of list) {
      if ('run' in step) {
        if (!modules[step.run]) throw new Error(`Unknown module "${step.run}"`);
      } else if ('waitUntil' in step) {
        if (!waits[step.waitUntil]) throw new Error(`Unknown wait "${step.waitUntil}"`);
      } else if ('loop' in step) {
        if (inLoop) throw new Error('Nested loops are not supported');
        walk(step.loop.body, true);
      }
    }
  };
  walk(steps, false);
}

export function resolveAutoProgram(
  program: AutoProgram,
  moduleSequences: Map<string, AutoSequence>,
): ResolvedAutoProgram {
  for (const step of flattenModuleRefs(program.steps)) {
    if (!moduleSequences.has(step)) {
      throw new Error(`Module sequence missing for "${step}"`);
    }
  }
  for (const id of Object.keys(program.modules)) {
    if (!moduleSequences.has(id)) {
      throw new Error(`Module sequence missing for "${id}"`);
    }
  }
  return { program, moduleSequences };
}

function flattenModuleRefs(steps: ProgramStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if ('run' in step) ids.push(step.run);
    else if ('loop' in step) ids.push(...flattenModuleRefs(step.loop.body));
  }
  return ids;
}

export function findLeaveModuleId(program: AutoProgram): string | null {
  const last = program.steps[program.steps.length - 1];
  if (last && 'run' in last) return last.run;
  for (let i = program.steps.length - 1; i >= 0; i--) {
    const step = program.steps[i]!;
    if ('run' in step) return step.run;
  }
  return null;
}

export function programStartPose(resolved: ResolvedAutoProgram): AutoSequence['startPose'] | null {
  const firstRun = resolved.program.steps.find((s): s is { run: string } => 'run' in s);
  if (!firstRun) return null;
  return resolved.moduleSequences.get(firstRun.run)?.startPose ?? null;
}

export function waitSpecForId(
  program: AutoProgram,
  waitId: string,
): StoredCountWait {
  return program.waits?.[waitId] ?? DEFAULT_PROGRAM_WAITS[waitId] ?? {
    kind: 'storedCount',
    timeoutSec: 2,
    onTimeout: 'continue',
  };
}

export function storedCountWaitMet(spec: StoredCountWait, storedCount: number): boolean {
  if (spec.min !== undefined && storedCount < spec.min) return false;
  if (spec.max !== undefined && storedCount > spec.max) return false;
  return true;
}

export function waitShouldShoot(spec: StoredCountWait): boolean {
  return spec.max === 0;
}

export function waitShouldIntake(spec: StoredCountWait): boolean {
  return spec.min !== undefined && spec.min > 0;
}
