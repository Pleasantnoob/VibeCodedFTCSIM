import { autoSequenceForAlliance } from './mirror-path.js';
import {
  parseAutoProgramText,
  resolveAutoProgram,
  type AutoProgram,
  type ResolvedAutoProgram,
} from './auto-program.js';
import { parsePathFileText } from './load-path.js';

export async function fetchAndResolveAutoProgram(
  program: AutoProgram,
  fetchText: (url: string) => Promise<string>,
  alliance: 'blue' | 'red' = 'blue',
): Promise<ResolvedAutoProgram> {
  const moduleSequences = new Map<string, import('./auto-sequence.js').AutoSequence>();
  for (const [id, ref] of Object.entries(program.modules)) {
    const text = await fetchText(ref.path);
    const parsed = parsePathFileText(text);
    if (!parsed.autoSequence) {
      throw new Error(`Module "${id}" (${ref.path}) has no auto sequence`);
    }
    moduleSequences.set(id, autoSequenceForAlliance(parsed.autoSequence, alliance));
  }
  return resolveAutoProgram(program, moduleSequences);
}

export async function loadAutoProgramFromText(
  programText: string,
  fetchText: (url: string) => Promise<string>,
  alliance: 'blue' | 'red' = 'blue',
): Promise<ResolvedAutoProgram> {
  const program = parseAutoProgramText(programText);
  return fetchAndResolveAutoProgram(program, fetchText, alliance);
}

export async function loadAutoProgramFromUrl(
  url: string,
  fetchText: (url: string) => Promise<string>,
  alliance: 'blue' | 'red' = 'blue',
): Promise<ResolvedAutoProgram> {
  const programText = await fetchText(url);
  return loadAutoProgramFromText(programText, fetchText, alliance);
}
