import {
  applyPerformancePreset,
  SIM_ROBOT_PRESETS,
  type MechanismTimingConfig,
  type PerformancePresetId,
  type SimRobotConfig,
} from '../robot/robot-config';
import { ROBOT_SKIN_OPTIONS, type RobotSkinId } from '../robot/robot-skins';
import { PanelSection } from './panels';

export interface AdvancedSettingsDrawerProps {
  onClose: () => void;
  robotConfig: SimRobotConfig;
  onRobotConfigChange: (patch: Partial<SimRobotConfig>) => void;
  onRobotPresetChange: (presetId: string) => void;
  robotSkinId: RobotSkinId;
  onRobotSkinIdChange: (id: RobotSkinId) => void;
  onPathUpload: (file: File) => void;
  onProgramUpload: (file: File) => void;
  autoMode: 'simple' | 'program';
  overlayEventName: string;
  onOverlayEventNameChange: (value: string) => void;
  overlayMatchName: string;
  onOverlayMatchNameChange: (value: string) => void;
  overlayRedTeams: [string, string];
  onOverlayRedTeamsChange: (teams: [string, string]) => void;
  overlayBlueTeams: [string, string];
  onOverlayBlueTeamsChange: (teams: [string, string]) => void;
  matchSounds: boolean;
  onMatchSoundsChange: (value: boolean) => void;
  matchSoundVolume: number;
  onMatchSoundVolumeChange: (value: number) => void;
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

export function AdvancedSettingsDrawer({
  onClose,
  robotConfig,
  onRobotConfigChange,
  onRobotPresetChange,
  robotSkinId,
  onRobotSkinIdChange,
  onPathUpload,
  onProgramUpload,
  autoMode,
  overlayEventName,
  onOverlayEventNameChange,
  overlayMatchName,
  onOverlayMatchNameChange,
  overlayRedTeams,
  onOverlayRedTeamsChange,
  overlayBlueTeams,
  onOverlayBlueTeamsChange,
  matchSounds,
  onMatchSoundsChange,
  matchSoundVolume,
  onMatchSoundVolumeChange,
}: AdvancedSettingsDrawerProps) {
  const applyPreset = (preset: PerformancePresetId) => {
    if (preset === 'custom') {
      onRobotConfigChange({ performancePreset: 'custom' });
      return;
    }
    onRobotConfigChange(applyPerformancePreset(preset));
  };

  return (
    <aside className="advanced-drawer" aria-label="Advanced settings">
      <div className="advanced-drawer__header">
        <strong>Advanced settings</strong>
        <button type="button" className="advanced-drawer__close" onClick={onClose}>
          Close
        </button>
      </div>

      <PanelSection title="Robot" badge={`${robotConfig.footprintLength}×${robotConfig.footprintWidth} in`}>
        <label className="panel-field">
          Preset
          <select
            className="panel-select"
            value={robotConfig.presetId}
            onChange={(e) => onRobotPresetChange(e.target.value)}
          >
            {SIM_ROBOT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="panel-field">
          Skin
          <select
            className="panel-select"
            value={robotSkinId}
            onChange={(e) => onRobotSkinIdChange(e.target.value as RobotSkinId)}
          >
            {ROBOT_SKIN_OPTIONS.map((skin) => (
              <option key={skin.id} value={skin.id}>
                {skin.label}
              </option>
            ))}
          </select>
        </label>
        <details className="panel-details">
          <summary>Advanced drivetrain</summary>
          <label className="panel-label">
            Top speed: <strong>{robotConfig.maxVelocity.toFixed(0)} in/s</strong>
            <input
              type="range"
              min={10}
              max={80}
              step={1}
              value={robotConfig.maxVelocity}
              onChange={(e) => onRobotConfigChange({ maxVelocity: Number(e.target.value) })}
            />
          </label>
          <label className="panel-label">
            Acceleration: <strong>{robotConfig.maxAcceleration.toFixed(0)} in/s²</strong>
            <input
              type="range"
              min={12}
              max={120}
              step={1}
              value={robotConfig.maxAcceleration}
              onChange={(e) => onRobotConfigChange({ maxAcceleration: Number(e.target.value) })}
            />
          </label>
          <label className="panel-label">
            Weight: <strong>{robotConfig.mass.toFixed(0)} lb</strong>
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={robotConfig.mass}
              onChange={(e) => onRobotConfigChange({ mass: Number(e.target.value) })}
            />
          </label>
          <label className="panel-label">
            Turn speed: <strong>{robotConfig.maxAngularVelocity.toFixed(1)} rad/s</strong>
            <input
              type="range"
              min={1}
              max={8}
              step={0.1}
              value={robotConfig.maxAngularVelocity}
              onChange={(e) => onRobotConfigChange({ maxAngularVelocity: Number(e.target.value) })}
            />
          </label>
          <label className="panel-label">
            Turn acceleration: <strong>{robotConfig.maxAngularAcceleration.toFixed(0)} rad/s²</strong>
            <input
              type="range"
              min={6}
              max={36}
              step={1}
              value={robotConfig.maxAngularAcceleration}
              onChange={(e) =>
                onRobotConfigChange({ maxAngularAcceleration: Number(e.target.value) })
              }
            />
          </label>
          <label className="panel-label">
            Length: <strong>{robotConfig.footprintLength.toFixed(0)} in</strong>
            <input
              type="range"
              min={10}
              max={18}
              step={1}
              value={robotConfig.footprintLength}
              onChange={(e) => onRobotConfigChange({ footprintLength: Number(e.target.value) })}
            />
          </label>
          <label className="panel-label">
            Width: <strong>{robotConfig.footprintWidth.toFixed(0)} in</strong>
            <input
              type="range"
              min={10}
              max={18}
              step={1}
              value={robotConfig.footprintWidth}
              onChange={(e) => onRobotConfigChange({ footprintWidth: Number(e.target.value) })}
            />
          </label>
        </details>
      </PanelSection>

      <PanelSection title="Auto performance" badge={robotConfig.performancePreset}>
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
      </PanelSection>

      <PanelSection title="Auto imports">
        <p className="hint hint--compact">
          Upload custom {autoMode === 'program' ? 'programs (.json) or ' : ''}routines (.json / .pp).
        </p>
        {autoMode === 'program' ? (
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
        ) : null}
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
      </PanelSection>

      <PanelSection title="Broadcast HUD" badge={overlayMatchName}>
        <p className="hint hint--compact">Scoreboard overlay labels and audio. Toggle visibility in Debug menu.</p>
        <label className="panel-field">
          Event name
          <input
            className="panel-select"
            type="text"
            value={overlayEventName}
            onChange={(e) => onOverlayEventNameChange(e.target.value)}
          />
        </label>
        <label className="panel-field">
          Match name
          <input
            className="panel-select"
            type="text"
            value={overlayMatchName}
            onChange={(e) => onOverlayMatchNameChange(e.target.value)}
          />
        </label>
        <label className="panel-field">
          Red team 1
          <input
            className="panel-select"
            type="text"
            value={overlayRedTeams[0]}
            onChange={(e) => onOverlayRedTeamsChange([e.target.value, overlayRedTeams[1]])}
          />
        </label>
        <label className="panel-field">
          Red team 2
          <input
            className="panel-select"
            type="text"
            value={overlayRedTeams[1]}
            onChange={(e) => onOverlayRedTeamsChange([overlayRedTeams[0], e.target.value])}
          />
        </label>
        <label className="panel-field">
          Blue team 1
          <input
            className="panel-select"
            type="text"
            value={overlayBlueTeams[0]}
            onChange={(e) => onOverlayBlueTeamsChange([e.target.value, overlayBlueTeams[1]])}
          />
        </label>
        <label className="panel-field">
          Blue team 2
          <input
            className="panel-select"
            type="text"
            value={overlayBlueTeams[1]}
            onChange={(e) => onOverlayBlueTeamsChange([overlayBlueTeams[0], e.target.value])}
          />
        </label>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={matchSounds}
            onChange={(e) => onMatchSoundsChange(e.target.checked)}
          />
          Match sounds (FTC Live audio)
        </label>
        <label className="panel-label">
          Game volume: <strong>{Math.round(matchSoundVolume * 100)}%</strong>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(matchSoundVolume * 100)}
            disabled={!matchSounds}
            onChange={(e) => onMatchSoundVolumeChange(Number(e.target.value) / 100)}
          />
        </label>
      </PanelSection>
    </aside>
  );
}
