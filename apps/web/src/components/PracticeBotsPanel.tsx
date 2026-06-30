import type { BotRobotId, BotSlotConfig, Difficulty } from '@ftc-sim/bot';
import { defaultPracticeBotSlots } from '@ftc-sim/bot';
import { SOLO_SPAWN_LABELS, type SoloSpawnSlot } from '../robot/match-robots';
import { patchPlayerSettings } from '../input/player-settings';
import { BUILTIN_PATHS, type BuiltinPathId } from './AutoProgramPanel';

export interface PracticeBotsPanelProps {
  botsEnabled: boolean;
  onBotsEnabledChange: (enabled: boolean) => void;
  botDifficulty: Difficulty;
  onBotDifficultyChange: (difficulty: Difficulty) => void;
  practiceNpcSlots: SoloSpawnSlot[];
  botSlotConfigs: BotSlotConfig[];
  humanInputRobotIds: Set<string>;
  isHostSession: boolean;
  onUpdateBotSlot: (robotId: BotRobotId, patch: Partial<BotSlotConfig>) => void;
  onLoadBuiltinPath: (robotId: BotRobotId, id: BuiltinPathId) => Promise<void>;
  onLoadPathFromFile: (robotId: BotRobotId, text: string, label: string) => void;
  onClearPath: (robotId: BotRobotId) => void;
}

export function PracticeBotsPanel({
  botsEnabled,
  onBotsEnabledChange,
  botDifficulty,
  onBotDifficultyChange,
  practiceNpcSlots,
  botSlotConfigs,
  humanInputRobotIds,
  isHostSession,
  onUpdateBotSlot,
  onLoadBuiltinPath,
  onLoadPathFromFile,
  onClearPath,
}: PracticeBotsPanelProps) {
  const enabledCount = botSlotConfigs.filter((slot) => slot.enabled).length;

  return (
    <>
      <p className="hint">
        Enable bots, then pick which NPC slots spawn on the field.
        {isHostSession ? ' Unclaimed robot slots are filled on the match server.' : ''}
      </p>
      <div className="practice-bots__header">
        <label className="panel-check">
          <input
            type="checkbox"
            checked={botsEnabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              onBotsEnabledChange(enabled);
              patchPlayerSettings({ practiceBotsEnabled: enabled });
            }}
          />
          Enable
        </label>
        <label className="panel-field">
          Difficulty
          <select
            className="panel-select"
            value={botDifficulty}
            disabled={!botsEnabled}
            onChange={(e) => onBotDifficultyChange(e.target.value as Difficulty)}
          >
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        {botsEnabled ? (
          <span className="hint hint--compact">{enabledCount} on field</span>
        ) : null}
      </div>

      {practiceNpcSlots.map((robotId) => {
        const slot =
          botSlotConfigs.find((entry) => entry.robotId === robotId) ??
          defaultPracticeBotSlots(botDifficulty).find((entry) => entry.robotId === robotId)!;
        const autoPath = slot.autoPath;
        const humanDrivesSlot = humanInputRobotIds.has(robotId);
        const pathLabel = autoPath?.label ?? 'none';

        return (
          <div key={robotId}>
            <div className="bot-slot-config--compact">
              <span className="bot-slot-config--compact__label">{SOLO_SPAWN_LABELS[robotId]}</span>
              <span className="bot-slot-config--compact__badge" title={pathLabel}>
                {pathLabel}
              </span>
              {humanDrivesSlot ? (
                <span className="hint hint--compact">You drive</span>
              ) : (
                <label className="panel-check">
                  <input
                    type="checkbox"
                    checked={slot.enabled}
                    disabled={!botsEnabled}
                    onChange={(e) => onUpdateBotSlot(robotId, { enabled: e.target.checked })}
                  />
                  Spawn
                </label>
              )}
            </div>
            {!humanDrivesSlot && slot.enabled && botsEnabled ? (
              <details className="panel-details">
                <summary>Path &amp; AUTO for {SOLO_SPAWN_LABELS[robotId]}</summary>
                <label className="panel-check">
                  <input
                    type="checkbox"
                    checked={slot.runAuto}
                    disabled={!autoPath}
                    onChange={(e) => onUpdateBotSlot(robotId, { runAuto: e.target.checked })}
                  />
                  Run AUTO
                </label>
                <label className="panel-field">
                  Example
                  <select
                    className="panel-select"
                    value=""
                    onChange={(e) => {
                      const id = e.target.value as BuiltinPathId;
                      if (!id) return;
                      void onLoadBuiltinPath(robotId, id).catch((err) => console.error(err));
                      e.target.value = '';
                    }}
                  >
                    <option value="">Load example…</option>
                    {BUILTIN_PATHS.map((path) => (
                      <option key={path.id} value={path.id}>
                        {path.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="panel-btn panel-btn--secondary bot-slot-config__upload">
                  <input
                    type="file"
                    accept=".json,.pp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      void file.text().then(
                        (text) => onLoadPathFromFile(robotId, text, file.name),
                        (err) => console.error(err),
                      );
                    }}
                  />
                  Upload .json / .pp
                </label>
                {autoPath ? (
                  <button
                    type="button"
                    className="panel-btn panel-btn--ghost bot-slot-config__clear"
                    onClick={() => onClearPath(robotId)}
                  >
                    Clear path
                  </button>
                ) : null}
              </details>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
