import { useCallback, useEffect, useState } from 'react';
import type { DriveFrame } from '@ftc-sim/robot';
import {
  DRIVE_ACTION_LABELS,
  DEFAULT_DRIVE_KEYBINDS,
  formatKeyCode,
  loadDriveKeybinds,
  resetDriveKeybinds,
  saveDriveKeybinds,
  type DriveAction,
  type DriveKeybinds,
} from './drive-keybinds';
import { loadDriveSettings, saveDriveSettings, type DriveSettings } from './drive-settings';

export interface DriveControlsPanelProps {
  onSettingsChange?: (settings: DriveSettings, keybinds: DriveKeybinds) => void;
}

const DRIVE_ACTIONS: DriveAction[] = [
  'forward',
  'backward',
  'strafeLeft',
  'strafeRight',
  'turnLeft',
  'turnRight',
  'brake',
  'intake',
  'shoot',
  'gate',
];

export function DriveControlsPanel({ onSettingsChange }: DriveControlsPanelProps) {
  const [settings, setSettings] = useState<DriveSettings>(() => loadDriveSettings());
  const [keybinds, setKeybinds] = useState<DriveKeybinds>(() => loadDriveKeybinds());
  const [listeningFor, setListeningFor] = useState<DriveAction | null>(null);

  const emit = useCallback(
    (nextSettings: DriveSettings, nextKeybinds: DriveKeybinds) => {
      onSettingsChange?.(nextSettings, nextKeybinds);
    },
    [onSettingsChange],
  );

  useEffect(() => {
    emit(settings, keybinds);
  }, [settings, keybinds, emit]);

  useEffect(() => {
    if (!listeningFor) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setListeningFor(null);
        return;
      }
      if (event.code === 'Backspace' || event.code === 'Delete') {
        setKeybinds((prev) => {
          const next = { ...prev, [listeningFor]: DEFAULT_DRIVE_KEYBINDS[listeningFor] };
          saveDriveKeybinds(next);
          return next;
        });
        setListeningFor(null);
        return;
      }
      setKeybinds((prev) => {
        const next = { ...prev, [listeningFor]: event.code };
        saveDriveKeybinds(next);
        return next;
      });
      setListeningFor(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listeningFor]);

  const setDriveFrame = (driveFrame: DriveFrame) => {
    const next = { driveFrame };
    setSettings(next);
    saveDriveSettings(next);
  };

  return (
    <div className="drive-controls">
      <fieldset className="drive-controls__frame">
        <legend>Drive mode</legend>
        <label className="drive-controls__radio">
          <input
            type="radio"
            name="drive-frame"
            checked={settings.driveFrame === 'robot'}
            onChange={() => setDriveFrame('robot')}
          />
          Robot-centric — W forward, A strafe left relative to robot heading
        </label>
        <label className="drive-controls__radio">
          <input
            type="radio"
            name="drive-frame"
            checked={settings.driveFrame === 'field'}
            onChange={() => setDriveFrame('field')}
          />
          Field-centric — W north, D east on the field
        </label>
      </fieldset>

      <div className="drive-controls__binds">
        <div className="drive-controls__binds-header">
          <span>Keyboard binds</span>
          <button
            type="button"
            className="drive-controls__reset"
            onClick={() => {
              const next = resetDriveKeybinds();
              setKeybinds(next);
            }}
          >
            Reset defaults
          </button>
        </div>
        {listeningFor && (
          <p className="drive-controls__listening">Press a key for {DRIVE_ACTION_LABELS[listeningFor]} (Esc cancel)</p>
        )}
        <ul className="drive-controls__bind-list">
          {DRIVE_ACTIONS.map((action) => (
            <li key={action}>
              <span>{DRIVE_ACTION_LABELS[action]}</span>
              <button
                type="button"
                className={`drive-controls__bind-btn${listeningFor === action ? ' drive-controls__bind-btn--listening' : ''}`}
                onClick={() => setListeningFor(action)}
              >
                {formatKeyCode(keybinds[action])}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="hint">
        Gamepad: left stick drive, right stick X turn, LB brake, LT intake, RT shoot, B gate. Settings apply in solo,
        host, join, and spectator when you claim a robot.
      </p>
    </div>
  );
}
