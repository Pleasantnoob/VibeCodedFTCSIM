import type { AutoProgramRunnerDebug } from '@ftc-sim/pedro';
import {
  applyPerformancePreset,
  type MechanismTimingConfig,
  type PerformancePresetId,
  type SimRobotConfig,
} from '../robot/robot-config';
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
  robotConfig: SimRobotConfig;
  onRobotConfigChange: (patch: Partial<SimRobotConfig>) => void;
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
  programDebug: AutoProgramRunnerDebug | null;
  followerHud: {
    progress: { completion: number };
    errors: { translational: number; heading: number };
    distRemaining: number;
  } | null;
  onLoadBuiltinPath: (id: BuiltinPathId) => void;
  onLoadBuiltinProgram: (id: BuiltinProgramId) => void;
  onPathUpload: (file: File) => void;
  onProgramUpload: (file: File) => void;
  onClear: () => void;
}

function patchMechanismTiming(
  robot: SimRobotConfig,
  patch: Partial<MechanismTimingConfig>,
): SimRobotConfig {
  return {
    ...robot,
    performancePreset: 'custom',
    mechanismTiming: { ...robot.mechanismTiming, ...patch },
  };
}

export function AutoProgramPanel({
  autoMode,
  onAutoModeChange,
  robotConfig,
  onRobotConfigChange,
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
  programDebug,
  followerHud,
  onLoadBuiltinPath,
  onLoadBuiltinProgram,
  onPathUpload,
  onProgramUpload,
  onClear,
}: AutoProgramPanelProps) {
  const applyPreset = (preset: PerformancePresetId) => {
    if (preset === 'custom') {
      onRobotConfigChange({ performancePreset: 'custom' });
      return;
    }
    onRobotConfigChange(applyPerformancePreset(preset));
  };

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
            <PanelsButton onClick={() => onLoadBuiltinPath(selectedPathId)}>Add routine</PanelsButton>
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            Modular AUTO: separate .pp modules for collect / shoot / leave, with loop-until-leave timing
            and wait-until-full / wait-until-empty steps.
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
            <PanelsButton onClick={() => onLoadBuiltinProgram(selectedProgramId)}>
              Load program
            </PanelsButton>
          </div>
          {loadedProgramLabel ? (
            <p className="hint hint--compact">Loaded: {loadedProgramLabel}</p>
          ) : null}
          <label className="panel-btn panel-btn--secondary">
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onProgramUpload(file);
                e.target.value = '';
              }}
            />
            Upload program (.json)
          </label>
        </>
      )}

      <label className="panel-btn panel-btn--secondary">
        <input
          type="file"
          accept=".json,.pp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPathUpload(file);
            e.target.value = '';
          }}
        />
        Upload routine (.json / .pp)
      </label>

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

      <p className="hint hint--compact">
        Tune fire rate and wait timeouts in <strong>Performance</strong> below (shoot interval = ms between shots).
      </p>

      <details className="panel-details" open>
        <summary>Performance</summary>
        <label className="panel-field">
          Preset
          <select
            className="panel-select"
            value={robotConfig.performancePreset}
            onChange={(e) => applyPreset(e.target.value as PerformancePresetId)}
          >
            <option value="stock">Stock</option>
            <option value="competitive">Competitive</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="panel-field">
          Top speed ({robotConfig.maxVelocity.toFixed(0)} in/s)
          <input
            type="range"
            min={10}
            max={80}
            step={1}
            value={robotConfig.maxVelocity}
            onChange={(e) =>
              onRobotConfigChange({
                performancePreset: 'custom',
                maxVelocity: Number(e.target.value),
              })
            }
          />
        </label>
        <label className="panel-field">
          Acceleration ({robotConfig.maxAcceleration.toFixed(0)} in/s²)
          <input
            type="range"
            min={12}
            max={120}
            step={1}
            value={robotConfig.maxAcceleration}
            onChange={(e) =>
              onRobotConfigChange({
                performancePreset: 'custom',
                maxAcceleration: Number(e.target.value),
              })
            }
          />
        </label>
        <label className="panel-field">
          Shoot interval ({(robotConfig.mechanismTiming.shootHoldIntervalSec * 1000).toFixed(0)} ms)
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={robotConfig.mechanismTiming.shootHoldIntervalSec * 1000}
            onChange={(e) =>
              onRobotConfigChange(
                patchMechanismTiming(robotConfig, {
                  shootHoldIntervalSec: Number(e.target.value) / 1000,
                }),
              )
            }
          />
        </label>
        <label className="panel-field">
          Intake-full wait ({robotConfig.mechanismTiming.intakeFullWaitTimeoutSec.toFixed(1)} s)
          <input
            type="range"
            min={0.5}
            max={8}
            step={0.1}
            value={robotConfig.mechanismTiming.intakeFullWaitTimeoutSec}
            onChange={(e) =>
              onRobotConfigChange(
                patchMechanismTiming(robotConfig, {
                  intakeFullWaitTimeoutSec: Number(e.target.value),
                }),
              )
            }
          />
        </label>
        <label className="panel-field">
          Shoot-empty wait ({robotConfig.mechanismTiming.shootEmptyWaitTimeoutSec.toFixed(1)} s)
          <input
            type="range"
            min={1}
            max={10}
            step={0.1}
            value={robotConfig.mechanismTiming.shootEmptyWaitTimeoutSec}
            onChange={(e) =>
              onRobotConfigChange(
                patchMechanismTiming(robotConfig, {
                  shootEmptyWaitTimeoutSec: Number(e.target.value),
                }),
              )
            }
          />
        </label>
        <label className="panel-field">
          Leave safety margin ({robotConfig.mechanismTiming.leaveSafetyMarginSec.toFixed(1)} s)
          <input
            type="range"
            min={0.5}
            max={6}
            step={0.1}
            value={robotConfig.mechanismTiming.leaveSafetyMarginSec}
            onChange={(e) =>
              onRobotConfigChange(
                patchMechanismTiming(robotConfig, {
                  leaveSafetyMarginSec: Number(e.target.value),
                }),
              )
            }
          />
        </label>
      </details>

      {programDebug && programDebug.mode === 'program' && (
        <ul className="metrics">
          <li>
            Program: <strong>loop {programDebug.loopCount}</strong>
            {programDebug.waitKind ? ` · wait ${programDebug.waitKind}` : ''}
            {` · leave budget ${programDebug.leaveBudgetSec.toFixed(1)}s`}
          </li>
        </ul>
      )}

      {followerHud && (
        <ul className="metrics">
          <li>
            Progress: <strong>{(followerHud.progress.completion * 100).toFixed(0)}%</strong>
          </li>
          <li>
            Trans. error: <strong>{followerHud.errors.translational.toFixed(2)} in</strong>
          </li>
          <li>
            Heading error: <strong>{followerHud.errors.heading.toFixed(3)} rad</strong>
          </li>
          <li>
            Dist. remaining: <strong>{followerHud.distRemaining.toFixed(1)} in</strong>
          </li>
        </ul>
      )}
    </>
  );
}
