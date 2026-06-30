export interface DebugMenuProps {
  devToolsOpen: boolean;
  onToggleDevTools: () => void;
  showBotFieldDebug: boolean;
  onShowBotFieldDebugChange: (value: boolean) => void;
  showPlannedPath: boolean;
  onShowPlannedPathChange: (value: boolean) => void;
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
  editBarriers: boolean;
  onEditBarriersChange: (value: boolean) => void;
}

export function DebugMenu({
  devToolsOpen,
  onToggleDevTools,
  showBotFieldDebug,
  onShowBotFieldDebugChange,
  showPlannedPath,
  onShowPlannedPathChange,
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
  editBarriers,
  onEditBarriersChange,
}: DebugMenuProps) {
  return (
    <details className="panels-nav__debug-menu">
      <summary
        className={`panels-btn panels-btn--${devToolsOpen ? 'primary' : 'ghost'} panels-nav__menu-summary`}
      >
        Debug ▾
      </summary>
      <div className="panels-nav__menu-panel" role="menu">
        <button type="button" className="panels-nav__menu-item" role="menuitem" onClick={onToggleDevTools}>
          {devToolsOpen ? 'Close debug panel' : 'Open debug panel'}
        </button>
        <div className="panels-nav__menu-sep" aria-hidden />
        <label className="panels-nav__menu-item panels-nav__menu-item--check" role="menuitemcheckbox">
          <input
            type="checkbox"
            checked={showBotFieldDebug}
            onChange={(e) => onShowBotFieldDebugChange(e.target.checked)}
          />
          Bot path overlay
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check" role="menuitemcheckbox">
          <input
            type="checkbox"
            checked={showPlannedPath}
            onChange={(e) => onShowPlannedPathChange(e.target.checked)}
          />
          Planned AUTO route
        </label>
        <div className="panels-nav__menu-sep" aria-hidden />
        <div className="panels-nav__menu-label">Overlays</div>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input type="checkbox" checked={showZones} onChange={(e) => onShowZonesChange(e.target.checked)} />
          Launch zones + grid
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input
            type="checkbox"
            checked={showGateDetector}
            onChange={(e) => onShowGateDetectorChange(e.target.checked)}
          />
          Gate debug
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input
            type="checkbox"
            checked={showDebugZones}
            onChange={(e) => onShowDebugZonesChange(e.target.checked)}
          />
          Scoring zones
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input
            type="checkbox"
            checked={showArtifacts}
            onChange={(e) => onShowArtifactsChange(e.target.checked)}
          />
          Game pieces
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input
            type="checkbox"
            checked={showCenterLine}
            onChange={(e) => onShowCenterLineChange(e.target.checked)}
          />
          Center line
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input
            type="checkbox"
            checked={showBarriers}
            onChange={(e) => onShowBarriersChange(e.target.checked)}
          />
          Goal barriers
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input
            type="checkbox"
            checked={showMatchOverlay}
            onChange={(e) => onShowMatchOverlayChange(e.target.checked)}
          />
          FTC match timer overlay
        </label>
        <div className="panels-nav__menu-sep" aria-hidden />
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input type="checkbox" checked={editZones} onChange={(e) => onEditZonesChange(e.target.checked)} />
          Edit launch zones
        </label>
        <label className="panels-nav__menu-item panels-nav__menu-item--check">
          <input
            type="checkbox"
            checked={editBarriers}
            onChange={(e) => onEditBarriersChange(e.target.checked)}
          />
          Edit goal barriers
        </label>
      </div>
    </details>
  );
}
