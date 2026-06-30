import type { AutoMode } from '../input/player-settings';
import { PanelsButton } from './panels';

export const BUILTIN_AUTO_PROGRAMS = [
  {
    id: 'duo-cycle-leave' as const,
    label: 'Duo cycle + leave',
    file: '/examples/auto-programs/duo-cycle-leave.json',
  },
];

export const BUILTIN_PATHS = [
  { id: 'decode-pp' as const, label: 'Decode Auto (PP export)', file: '/examples/decode-auto.pp' },
  { id: 'decode-json' as const, label: 'Decode Auto (JSON curve)', file: '/examples/decode-auto.json' },
  { id: 'really-good' as const, label: 'Really Good Path Test', file: '/examples/really-good-path-test.pp' },
  { id: 'super-duo-far12' as const, label: 'Super Duo Far 12', file: '/examples/super-duo-far12.pp' },
  { id: 'super-duo-near12' as const, label: 'Super Duo Near 12', file: '/examples/super-duo-near12.pp' },
  { id: 'simple-duo-far' as const, label: 'Simple Duo Far', file: '/examples/simple-duo-far.pp' },
  { id: 'super-simple-far' as const, label: 'Super Simple Far', file: '/examples/super-simple-far.pp' },
];

export type BuiltinPathId = (typeof BUILTIN_PATHS)[number]['id'];
export type BuiltinProgramId = (typeof BUILTIN_AUTO_PROGRAMS)[number]['id'];

export interface AutoProgramPanelProps {
  autoMode: AutoMode;
  onAutoModeChange: (mode: AutoMode) => void;
  selectedPathId: BuiltinPathId;
  onSelectedPathIdChange: (id: BuiltinPathId) => void;
  selectedProgramId: BuiltinProgramId;
  onSelectedProgramIdChange: (id: BuiltinProgramId) => void;
  loadedPathId: string | null;
  loadedProgramLabel: string | null;
  pathFormat: string | null;
  pathError: string | null;
  pathWarnings: string[];
  showPlannedPath: boolean;
  onShowPlannedPathChange: (show: boolean) => void;
  onLoadBuiltinPath: (id: BuiltinPathId) => void;
  onLoadBuiltinProgram: (id: BuiltinProgramId) => void;
  onClear: () => void;
  onOpenAdvanced?: () => void;
}

export function AutoProgramPanel({
  autoMode,
  onAutoModeChange,
  selectedPathId,
  onSelectedPathIdChange,
  selectedProgramId,
  onSelectedProgramIdChange,
  loadedPathId,
  loadedProgramLabel,
  pathFormat,
  pathError,
  pathWarnings,
  showPlannedPath,
  onShowPlannedPathChange,
  onLoadBuiltinPath,
  onLoadBuiltinProgram,
  onClear,
  onOpenAdvanced,
}: AutoProgramPanelProps) {
  return (
    <>
      <label className="panel-field">
        AUTO mode
        <select
          className="panel-select"
          value={autoMode}
          onChange={(e) => onAutoModeChange(e.target.value as AutoMode)}
        >
          <option value="simple">Simple path</option>
          <option value="program">Program (loops + waits)</option>
        </select>
      </label>

      {autoMode === 'simple' ? (
        <>
          <label className="panel-field">
            Routine
            <select
              className="panel-select"
              value={selectedPathId}
              onChange={(e) => onSelectedPathIdChange(e.target.value as BuiltinPathId)}
            >
              {BUILTIN_PATHS.map((path) => (
                <option key={path.id} value={path.id}>
                  {path.label}
                </option>
              ))}
            </select>
          </label>
          <div className="barrier-actions">
            <PanelsButton onClick={() => onLoadBuiltinPath(selectedPathId)}>Load</PanelsButton>
          </div>
        </>
      ) : (
        <>
          <p className="hint hint--compact">
            Modular AUTO with collect / shoot / leave modules and wait steps.
          </p>
          <label className="panel-field">
            Program template
            <select
              className="panel-select"
              value={selectedProgramId}
              onChange={(e) => onSelectedProgramIdChange(e.target.value as BuiltinProgramId)}
            >
              {BUILTIN_AUTO_PROGRAMS.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.label}
                </option>
              ))}
            </select>
          </label>
          <div className="barrier-actions">
            <PanelsButton onClick={() => onLoadBuiltinProgram(selectedProgramId)}>Load</PanelsButton>
          </div>
          {loadedProgramLabel ? (
            <p className="hint hint--compact">Loaded: {loadedProgramLabel}</p>
          ) : null}
        </>
      )}

      <label className="panel-check">
        <input
          type="checkbox"
          checked={showPlannedPath}
          onChange={(e) => onShowPlannedPathChange(e.target.checked)}
        />
        Show route before AUTO
      </label>

      {(loadedPathId || loadedProgramLabel) && (
        <div className="barrier-actions">
          <PanelsButton variant="default" onClick={onClear}>
            Clear AUTO
          </PanelsButton>
        </div>
      )}

      {pathFormat && <p className="hint hint--compact">Format: {pathFormat}</p>}
      {pathError && <p className="hint path-error">{pathError}</p>}
      {pathWarnings.map((warning) => (
        <p key={warning} className="hint">
          {warning}
        </p>
      ))}

      {onOpenAdvanced ? (
        <p className="hint hint--compact">
          Imports and performance tuning live in{' '}
          <button type="button" className="panel-btn panel-btn--ghost" onClick={onOpenAdvanced}>
            Advanced settings
          </button>
          .
        </p>
      ) : null}
    </>
  );
}
