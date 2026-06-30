export interface MatchMenuProps {
  disabled: boolean;
  canInfinite: boolean;
  canPause: boolean;
  canEndMatch: boolean;
  paused: boolean;
  onInfinite: () => void;
  onPause: () => void;
  onEndMatch: () => void;
  onReset: () => void;
}

export function MatchMenu({
  disabled,
  canInfinite,
  canPause,
  canEndMatch,
  paused,
  onInfinite,
  onPause,
  onEndMatch,
  onReset,
}: MatchMenuProps) {
  return (
    <details className="panels-nav__menu">
      <summary className="panels-btn panels-btn--ghost panels-nav__menu-summary">
        Match ▾
      </summary>
      <div className="panels-nav__menu-panel" role="menu">
        <button
          type="button"
          className="panels-nav__menu-item"
          role="menuitem"
          disabled={disabled || !canInfinite}
          onClick={onInfinite}
        >
          INF
        </button>
        <button
          type="button"
          className="panels-nav__menu-item"
          role="menuitem"
          disabled={disabled || !canPause}
          onClick={onPause}
        >
          {paused ? 'RESUME' : 'PAUSE'}
        </button>
        <button
          type="button"
          className="panels-nav__menu-item"
          role="menuitem"
          disabled={disabled || !canEndMatch}
          onClick={onEndMatch}
        >
          END MATCH
        </button>
        <div className="panels-nav__menu-sep" aria-hidden />
        <button
          type="button"
          className="panels-nav__menu-item"
          role="menuitem"
          disabled={disabled}
          onClick={onReset}
        >
          RESET
        </button>
      </div>
    </details>
  );
}
