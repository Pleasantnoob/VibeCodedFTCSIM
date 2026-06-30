import { useMemo, useState } from 'react';
import type { Vector2 } from '@ftc-sim/field';
import type { MechanismLogEntry } from '@ftc-sim/mechanisms';
import type { BotDebugLogCategory, BotDebugLogEntry } from '@ftc-sim/bot';
import type { MapVertexSelection } from '../field/map-selection';
import type { DriveInputDebug } from '../input/drive-input-sampler';
import { barrierSelection, zoneSelection } from '../field/map-selection';
import type { EditableBarrier } from '../field/barrier-editor';
import type { EditableZone } from '../field/zone-editor';
import type { AutoProgramRunnerDebug } from '@ftc-sim/pedro';
import { PanelSection, PanelsButton } from './panels';

export interface DevToolsDrawerProps {
  onClose: () => void;
  artifactFriction: number;
  onArtifactFrictionChange: (value: number) => void;
  showZones: boolean;
  onShowZonesChange: (value: boolean) => void;
  showGateDetector: boolean;
  onShowGateDetectorChange: (value: boolean) => void;
  showDebugZones: boolean;
  onShowDebugZonesChange: (value: boolean) => void;
  showArtifacts: boolean;
  onShowArtifactsChange: (value: boolean) => void;
  showCenterLine: boolean;
  onShowCenterLineChange: (value: boolean) => void;
  showBarriers: boolean;
  onShowBarriersChange: (value: boolean) => void;
  showMatchOverlay: boolean;
  onShowMatchOverlayChange: (value: boolean) => void;
  editZones: boolean;
  onEditZonesChange: (value: boolean) => void;
  zones: EditableZone[];
  selectedVertex: MapVertexSelection | null;
  selectedVertexCoords: Vector2 | null;
  onSelectVertex: (selection: MapVertexSelection | null) => void;
  onDeleteZoneVertex: () => void;
  onResetZones: () => void;
  onCopyZonesJson: () => void;
  editBarriers: boolean;
  onEditBarriersChange: (value: boolean) => void;
  barriers: EditableBarrier[];
  onResetBarriers: () => void;
  onCopyBarriersJson: () => void;
  copyStatus: string | null;
  mechanismDebugLogs: MechanismLogEntry[];
  onCopyMechanismLogs: () => void;
  botDebugLogs?: BotDebugLogEntry[];
  onCopyBotLogs?: () => void;
  driveDebug?: DriveInputDebug | null;
  controlSource?: string;
  matchPhase?: string;
  gamepadConnected?: boolean;
  poseLabel?: string;
  speed?: number;
  angularSpeed?: number;
  programDebug?: AutoProgramRunnerDebug | null;
  followerHud?: {
    progress: { completion: number };
    errors: { translational: number; heading: number };
    distRemaining: number;
  } | null;
}

const BOT_LOG_CATEGORIES: Array<BotDebugLogCategory | 'all'> = [
  'all',
  'warn',
  'plan',
  'motion',
  'drive',
  'task',
  'state',
  'avoid',
  'stuck',
];

function botLogCategoryClass(category: BotDebugLogCategory): string {
  if (category === 'warn') return 'bot-debug-log__cat--warn';
  if (category === 'plan') return 'bot-debug-log__cat--plan';
  if (category === 'motion') return 'bot-debug-log__cat--motion';
  return '';
}

export function DevToolsDrawer({
  onClose,
  artifactFriction,
  onArtifactFrictionChange,
  showZones,
  onShowZonesChange,
  showGateDetector,
  onShowGateDetectorChange,
  showDebugZones,
  onShowDebugZonesChange,
  showArtifacts,
  onShowArtifactsChange,
  showCenterLine,
  onShowCenterLineChange,
  showBarriers,
  onShowBarriersChange,
  showMatchOverlay,
  onShowMatchOverlayChange,
  editZones,
  onEditZonesChange,
  zones,
  selectedVertex,
  selectedVertexCoords,
  onSelectVertex,
  onDeleteZoneVertex,
  onResetZones,
  onCopyZonesJson,
  editBarriers,
  onEditBarriersChange,
  barriers,
  onResetBarriers,
  onCopyBarriersJson,
  copyStatus,
  mechanismDebugLogs,
  onCopyMechanismLogs,
  botDebugLogs = [],
  onCopyBotLogs,
  driveDebug,
  controlSource,
  matchPhase,
  gamepadConnected,
  poseLabel,
  speed,
  angularSpeed,
  programDebug,
  followerHud,
}: DevToolsDrawerProps) {
  const [botLogCategory, setBotLogCategory] = useState<BotDebugLogCategory | 'all'>('all');
  const [botLogRobot, setBotLogRobot] = useState<string>('all');
  const [botLogWarningsOnly, setBotLogWarningsOnly] = useState(false);

  const botRobotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of botDebugLogs) ids.add(entry.robotId);
    return [...ids].sort();
  }, [botDebugLogs]);

  const filteredBotLogs = useMemo(() => {
    return botDebugLogs.filter((entry) => {
      if (botLogWarningsOnly && entry.level !== 'warn' && entry.category !== 'warn') return false;
      if (botLogCategory !== 'all' && entry.category !== botLogCategory) return false;
      if (botLogRobot !== 'all' && entry.robotId !== botLogRobot) return false;
      return true;
    });
  }, [botDebugLogs, botLogCategory, botLogRobot, botLogWarningsOnly]);

  return (
    <aside className="dev-tools-drawer" aria-label="Developer tools">
      <div className="dev-tools-drawer__header">
        <strong>Dev tools</strong>
        <button type="button" className="dev-tools-drawer__close" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="hint dev-tools-drawer__sidebar-link">
        Bot path overlay and field overlays are in the <strong>Debug</strong> nav menu. Practice bots are in the sidebar.
      </p>

      <PanelSection title="Drive debug" badge={controlSource ?? 'none'} defaultOpen={false}>
        <ul className="metrics">
          <li>
            Match: <strong>{matchPhase ?? '—'}</strong>
          </li>
          <li>
            Input: <strong>{controlSource ?? '—'}</strong>
          </li>
          <li>
            Gamepad: <strong>{gamepadConnected ? 'connected' : 'none'}</strong>
          </li>
          {poseLabel && (
            <li>
              Pose: <strong>{poseLabel}</strong>
            </li>
          )}
          {speed != null && (
            <li>
              Speed: <strong>{speed.toFixed(1)} in/s</strong> · Turn{' '}
              <strong>{angularSpeed?.toFixed(2) ?? '0'} rad/s</strong>
            </li>
          )}
          {driveDebug && (
            <>
              <li>
                Drive: f={driveDebug.forward.toFixed(2)} s={driveDebug.strafe.toFixed(2)} t=
                {driveDebug.turn.toFixed(2)}
              </li>
              <li>
                Raw: f={driveDebug.rawForward.toFixed(2)} s={driveDebug.rawStrafe.toFixed(2)} t=
                {driveDebug.rawTurn.toFixed(2)}
              </li>
              {driveDebug.source === 'gamepad' && (
                <li>
                  Pad: {driveDebug.padAxes.map((v) => v.toFixed(2)).join(', ')}
                </li>
              )}
              <li>
                Intake: {driveDebug.intake.toFixed(2)} · Shoot: {driveDebug.shoot ? 'fire' : '—'}
              </li>
            </>
          )}
        </ul>
      </PanelSection>

      <PanelSection title="Mechanism debug" badge={`${mechanismDebugLogs.length} logs`} defaultOpen={false}>
        <p className="hint">
          Shoot / intake / gate proximity events. Also printed to the browser console (F12).
        </p>
        <div className="barrier-actions">
          <PanelsButton onClick={onCopyMechanismLogs}>Copy logs</PanelsButton>
        </div>
        <ul className="metrics score-events mechanism-debug-log">
          {mechanismDebugLogs
            .slice(-24)
            .reverse()
            .map((entry, index) => (
              <li key={`${entry.t}-${entry.category}-${index}`}>
                <span className="mechanism-debug-log__cat">[{entry.category}]</span> {entry.message}
                {entry.data ? (
                  <span className="mechanism-debug-log__data"> {JSON.stringify(entry.data)}</span>
                ) : null}
              </li>
            ))}
          {mechanismDebugLogs.length === 0 && (
            <li className="hint">Run a match — mechanism events appear here.</li>
          )}
        </ul>
      </PanelSection>

      <PanelSection title="Bot AI debug" badge={`${filteredBotLogs.length}/${botDebugLogs.length}`} defaultOpen={false}>
        <p className="hint">
          One-line bot logs: TARGET / LAUNCH / SHOOT / STORED / EMPTY. Enable practice bots and run teleop.
        </p>
        <div className="bot-debug-filters">
          <label className="panel-field">
            Category
            <select
              className="panel-select"
              value={botLogCategory}
              onChange={(event) => setBotLogCategory(event.target.value as BotDebugLogCategory | 'all')}
            >
              {BOT_LOG_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="panel-field">
            Robot
            <select
              className="panel-select"
              value={botLogRobot}
              onChange={(event) => setBotLogRobot(event.target.value)}
            >
              <option value="all">all</option>
              {botRobotIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="panel-check">
            <input
              type="checkbox"
              checked={botLogWarningsOnly}
              onChange={(event) => setBotLogWarningsOnly(event.target.checked)}
            />
            Warnings / flags only
          </label>
        </div>
        {onCopyBotLogs ? (
          <div className="barrier-actions">
            <PanelsButton onClick={onCopyBotLogs}>Copy bot logs</PanelsButton>
          </div>
        ) : null}
        <ul className="metrics score-events mechanism-debug-log bot-debug-log">
          {filteredBotLogs
            .slice(-80)
            .reverse()
            .map((entry, index) => (
              <li
                key={`${entry.tick}-${entry.robotId}-${entry.category}-${index}`}
                className={entry.level === 'warn' ? 'bot-debug-log__item--warn' : undefined}
              >
                <span className={`mechanism-debug-log__cat ${botLogCategoryClass(entry.category)}`}>
                  [{entry.category}]
                </span>{' '}
                <strong>{entry.robotId}</strong> — {entry.message}
              </li>
            ))}
          {filteredBotLogs.length === 0 && (
            <li className="hint">Enable practice bots and run teleop — collector logs appear here.</li>
          )}
        </ul>
      </PanelSection>

      <PanelSection title="Artifacts" badge={`μ ${artifactFriction.toFixed(2)}`}>
        <label className="panel-label">
          Surface friction: <strong>{artifactFriction.toFixed(2)}</strong>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.05}
            value={artifactFriction}
            onChange={(e) => onArtifactFrictionChange(Number(e.target.value))}
          />
        </label>
      </PanelSection>

      <PanelSection
        title="Overlays & zones"
        badge={editZones ? 'editing zones' : showZones ? 'grid on' : 'grid off'}
      >
        <label className="panel-check">
          <input type="checkbox" checked={showZones} onChange={(e) => onShowZonesChange(e.target.checked)} />
          Launch zones + tile grid
        </label>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={showGateDetector}
            onChange={(e) => onShowGateDetectorChange(e.target.checked)}
          />
          Gate debug (teal zone + robot footprint)
        </label>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={showDebugZones}
            onChange={(e) => onShowDebugZonesChange(e.target.checked)}
          />
          Scoring zones (basin, ramp, base)
        </label>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={showArtifacts}
            onChange={(e) => onShowArtifactsChange(e.target.checked)}
          />
          Game pieces (live artifacts)
        </label>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={showCenterLine}
            onChange={(e) => onShowCenterLineChange(e.target.checked)}
          />
          Center line (x=72)
        </label>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={showBarriers}
            onChange={(e) => onShowBarriersChange(e.target.checked)}
          />
          Goal barriers
        </label>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={showMatchOverlay}
            onChange={(e) => onShowMatchOverlayChange(e.target.checked)}
          />
          FTC match timer overlay
        </label>
        <label className="panel-check">
          <input type="checkbox" checked={editZones} onChange={(e) => onEditZonesChange(e.target.checked)} />
          Edit launch zones
        </label>
        {editZones && (
          <>
            <ul className="barrier-list">
              {zones.map((zone) => (
                <li key={zone.id}>
                  <button
                    type="button"
                    className={`barrier-list__item${selectedVertex?.layer === 'zone' && selectedVertex.zoneId === zone.id ? ' barrier-list__item--active' : ''}`}
                    onClick={() => onSelectVertex(zoneSelection(zone.id, 0))}
                  >
                    {zone.label}
                    <span>{zone.vertices.length} vertices</span>
                  </button>
                </li>
              ))}
            </ul>
            {selectedVertexCoords && selectedVertex?.layer === 'zone' && (
              <p className="barrier-selection">
                Vertex {selectedVertex.vertexIndex + 1}: ({selectedVertexCoords.x.toFixed(1)},{' '}
                {selectedVertexCoords.y.toFixed(1)})
              </p>
            )}
            <div className="barrier-actions">
              <PanelsButton disabled={selectedVertex?.layer !== 'zone'} onClick={onDeleteZoneVertex}>
                Delete vertex
              </PanelsButton>
              <PanelsButton onClick={onResetZones}>Reset defaults</PanelsButton>
              <PanelsButton onClick={onCopyZonesJson}>Copy JSON</PanelsButton>
            </div>
          </>
        )}
      </PanelSection>

      <PanelSection title="Goals" badge={editBarriers ? 'editing' : undefined}>
        <label className="panel-check">
          <input
            type="checkbox"
            checked={editBarriers}
            onChange={(e) => onEditBarriersChange(e.target.checked)}
          />
          Edit goal barriers
        </label>
        {editBarriers && (
          <>
            <ul className="barrier-list">
              {barriers.map((barrier) => (
                <li key={barrier.id}>
                  <button
                    type="button"
                    className={`barrier-list__item${selectedVertex?.layer === 'barrier' && selectedVertex.barrierId === barrier.id ? ' barrier-list__item--active' : ''}`}
                    onClick={() => onSelectVertex(barrierSelection(barrier.id, 0))}
                  >
                    {barrier.label}
                    <span>{barrier.vertices.length} vertices</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="barrier-actions">
              <PanelsButton onClick={onResetBarriers}>Reset goals</PanelsButton>
              <PanelsButton onClick={onCopyBarriersJson}>Copy goal JSON</PanelsButton>
            </div>
          </>
        )}
      </PanelSection>

      {(programDebug || followerHud) && (
        <PanelSection title="AUTO live metrics" defaultOpen={false}>
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
        </PanelSection>
      )}

      {copyStatus && <p className="hint dev-tools-drawer__status">{copyStatus}</p>}
    </aside>
  );
}
