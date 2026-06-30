import { useCallback, useEffect, useState } from 'react';

import type { DriveFrame } from '@ftc-sim/robot';

import {

  DRIVE_ACTION_LABELS,

  DEFAULT_DRIVE_KEYBINDS,

  formatKeyCode,

  resetDriveKeybinds,

  saveDriveKeybinds,

  type DriveAction,

  type DriveKeybinds,

} from './drive-keybinds';

import { loadPlayerSettings, patchPlayerSettings } from './player-settings';

import { PanelsButton } from '../components/panels';



export interface DriveControlsPanelProps {

  variant?: 'compact' | 'full';

  onOpenFullControls?: () => void;

  onSettingsChange?: (settings: { driveFrame: DriveFrame; keybinds: DriveKeybinds }) => void;

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

];



export function DriveControlsPanel({

  variant = 'full',

  onOpenFullControls,

  onSettingsChange,

}: DriveControlsPanelProps) {

  const initial = loadPlayerSettings();

  const [driveFrame, setDriveFrameState] = useState<DriveFrame>(initial.driveFrame);

  const [keybinds, setKeybinds] = useState<DriveKeybinds>(initial.keybinds);

  const [listeningFor, setListeningFor] = useState<DriveAction | null>(null);



  const emit = useCallback(

    (frame: DriveFrame, binds: DriveKeybinds) => {

      onSettingsChange?.({ driveFrame: frame, keybinds: binds });

    },

    [onSettingsChange],

  );



  useEffect(() => {

    emit(driveFrame, keybinds);

  }, [driveFrame, keybinds, emit]);



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



  const setDriveFrame = (frame: DriveFrame) => {

    setDriveFrameState(frame);

    patchPlayerSettings({ driveFrame: frame });

  };



  return (

    <div className="drive-controls">

      <fieldset className="drive-controls__frame">

        <legend>Drive mode</legend>

        <label className="drive-controls__radio">

          <input

            type="radio"

            name={`drive-frame-${variant}`}

            checked={driveFrame === 'robot'}

            onChange={() => setDriveFrame('robot')}

          />

          Robot-centric (W = forward)

        </label>

        <label className="drive-controls__radio">

          <input

            type="radio"

            name={`drive-frame-${variant}`}

            checked={driveFrame === 'field'}

            onChange={() => setDriveFrame('field')}

          />

          Field-centric (W = north)

        </label>

      </fieldset>



      {variant === 'compact' ? (

        <>

          {onOpenFullControls ? (

            <div className="teleop-compact__open-drawer">

              <PanelsButton type="button" onClick={onOpenFullControls}>

                Keyboard &amp; controller

              </PanelsButton>

            </div>

          ) : null}

          <p className="hint hint--compact">

            Gamepad: sticks move/turn, LT intake, RT shoot. Touchpad = fullscreen.

          </p>

        </>

      ) : (

        <>

          <div className="drive-controls__binds">

            <div className="drive-controls__binds-header">

              <span>Keyboard</span>

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

              <p className="drive-controls__listening">

                Press a key for {DRIVE_ACTION_LABELS[listeningFor]} (Esc to cancel)

              </p>

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



          <p className="hint hint--compact">

            Gamepad drive: left stick move, right stick turn, LT intake, RT shoot. Hold RB to aim at

            the goal while driving. Touchpad click toggles fullscreen; Start/Options = match flow; Share/Select = reset.

          </p>

        </>

      )}

    </div>

  );

}

