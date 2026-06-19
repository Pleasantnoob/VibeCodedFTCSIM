import { useLayoutEffect, useRef } from 'react';
import type { MatchSnapshot } from '@ftc-sim/match';
import { DECODE_RULES, countPatternMatchesFromState, type Alliance, type ArtifactColor, type MatchState, type ObeliskMotifId, type ScoreBreakdown } from '@ftc-sim/game-decode';
import { fitHudScale } from './display-fit';
import './match-overlay.css';

const THEME_LOGO = '/ftc-live/img/logos/decode_season_global_wide-435ecc08967fc32bb854c93f0c295df7.svg';
const GAME_LOGO = '/ftc-live/img/logos/decode_season_primary_wide-c77941e727bd4728cedbb92ae4044b4b.svg';
const ARTIFACT_WHITE = '/ftc-live/img/decode/artifact-white-b0d50498b8bee6cd5d6ce74eb53bdaf5.svg';
const ARTIFACT_PURPLE = '/ftc-live/img/decode/artifact-purple-19146db65fb592c497d688ef4799c58c.svg';
const ARTIFACT_GREEN = '/ftc-live/img/decode/artifact-green-b28e39c7be1f555d2d95077bd6c5447e.svg';

const ARTIFACT_SRC: Record<ArtifactColor, string> = {
  purple: ARTIFACT_PURPLE,
  green: ARTIFACT_GREEN,
};

const MOTIF_LABELS = {
  '21': 'GPP',
  '22': 'PGP',
  '23': 'PPG',
} as const;

const DEFAULT_RED_TEAMS: [string, string] = ['-1', '-2'];
const DEFAULT_BLUE_TEAMS: [string, string] = ['-3', '-4'];
const MOVEMENT_RP_THRESHOLD = 36;

function formatBroadcastTimer(snapshot: MatchSnapshot): string {
  if (snapshot.infiniteMode && snapshot.phase === 'teleop') return '∞';
  if (snapshot.phase === 'setup' || snapshot.phase === 'init' || snapshot.phase === 'post') {
    return '--:--';
  }
  const sec = Math.max(0, Math.ceil(snapshot.timeRemainingInPhase));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function mergeScores(a: ScoreBreakdown, b: ScoreBreakdown): ScoreBreakdown {
  return {
    leave: a.leave + b.leave,
    classified: a.classified + b.classified,
    overflow: a.overflow + b.overflow,
    depot: a.depot + b.depot,
    pattern: a.pattern + b.pattern,
    patternMatches: a.patternMatches + b.patternMatches,
    base: a.base + b.base,
    allianceBonus: a.allianceBonus + b.allianceBonus,
    foulPoints: a.foulPoints + b.foulPoints,
    total: a.total + b.total,
  };
}

function artifactCounts(score: ScoreBreakdown): { classified: number; overflow: number } {
  return {
    classified: Math.round(score.classified / DECODE_RULES.scoring.classified),
    overflow: Math.round(score.overflow / DECODE_RULES.scoring.overflow),
  };
}

function alliancePatternDisplay(matchGameState: MatchState | null, alliance: Alliance): number {
  if (!matchGameState) return 0;
  if (matchGameState.byAlliance) {
    const merged = mergeScores(
      matchGameState.byAlliance[alliance].autoScore,
      matchGameState.byAlliance[alliance].teleopScore,
    );
    if (merged.patternMatches > 0) return merged.patternMatches;
  }
  if (matchGameState.gateOpen[alliance]) return 0;
  return countPatternMatchesFromState(matchGameState, alliance);
}

function allianceHudStats(
  matchGameState: MatchState | null,
  alliance: Alliance,
): { total: number; classified: number; overflow: number; pattern: number } {
  if (!matchGameState?.byAlliance) {
    const score = mergeScores(matchGameState?.autoScore ?? emptyHud(), matchGameState?.teleopScore ?? emptyHud());
    const counts = artifactCounts(score);
    return {
      total: matchGameState?.score.total ?? 0,
      pattern: alliancePatternDisplay(matchGameState, alliance),
      ...counts,
    };
  }

  const bucket = matchGameState.byAlliance[alliance];
  const merged = mergeScores(bucket.autoScore, bucket.teleopScore);
  const counts = artifactCounts(merged);
  return {
    total: bucket.score.total,
    pattern: alliancePatternDisplay(matchGameState, alliance),
    ...counts,
  };
}

function emptyHud(): ScoreBreakdown {
  return {
    leave: 0,
    classified: 0,
    overflow: 0,
    depot: 0,
    pattern: 0,
    patternMatches: 0,
    base: 0,
    allianceBonus: 0,
    foulPoints: 0,
    total: 0,
  };
}

function IconGamepad() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden>
      <path d="M9.375 233.4C3.375 239.4 0 247.5 0 256v128c0 8.5 3.375 16.62 9.375 22.62S23.5 416 32 416h32V224H32C23.5 224 15.38 227.4 9.375 233.4zM464 96H352V32c0-17.62-14.38-32-32-32S288 14.38 288 32v64H176C131.8 96 96 131.8 96 176V448c0 35.38 28.62 64 64 64h320c35.38 0 64-28.62 64-64V176C544 131.8 508.3 96 464 96zM256 416H192v-32h64V416zM224 296C201.9 296 184 278.1 184 256S201.9 216 224 216S264 233.9 264 256S246.1 296 224 296zM352 416H288v-32h64V416zM448 416h-64v-32h64V416zM416 296c-22.12 0-40-17.88-40-40S393.9 216 416 216S456 233.9 456 256S438.1 296 416 296zM630.6 233.4C624.6 227.4 616.5 224 608 224h-32v192h32c8.5 0 16.62-3.375 22.62-9.375S640 392.5 640 384V256C640 247.5 636.6 239.4 630.6 233.4z" />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" aria-hidden>
      <path d="M438.6 278.6l-160 160C272.4 444.9 264.2 448 256 448s-16.38-3.125-22.62-9.375c-12.5-12.5-12.5-32.75 0-45.25L338.8 288H32C14.33 288 .0016 273.7 .0016 256S14.33 224 32 224h306.8l-105.4-105.4c-12.5-12.5-12.5-32.75 0-45.25s32.75-12.5 45.25 0l160 160C451.1 245.9 451.1 266.1 438.6 278.6z" />
    </svg>
  );
}

function IconTimes() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden>
      <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" />
    </svg>
  );
}

function LeaveMarks({ left }: { left: boolean }) {
  if (left) return <span className="leave-mark">1</span>;
  return <IconTimes />;
}

function PatternMotifLabel() {
  return (
    <div className="motif">
      <img src={ARTIFACT_WHITE} alt="" />
      <img src={ARTIFACT_WHITE} alt="" />
      <img src={ARTIFACT_WHITE} alt="" />
    </div>
  );
}

type PillIcon = 'gamepad' | 'arrow' | 'pattern' | 'artifact';

interface ScorePillProps {
  icon: PillIcon;
  value: React.ReactNode;
  goal?: string;
  className?: string;
}

function ScorePill({ icon, value, goal, className = '' }: ScorePillProps) {
  return (
    <div className={`scorePill ${className}`.trim()} style={{ '--pill-item-count': 1 } as React.CSSProperties}>
      <div className="label">
        {icon === 'pattern' ? (
          <PatternMotifLabel />
        ) : icon === 'artifact' ? (
          <img src={ARTIFACT_WHITE} alt="" className="single-artifact-icon" />
        ) : (
          <div className="svgWrapper fontAwesome">
            {icon === 'gamepad' ? <IconGamepad /> : <IconArrow />}
          </div>
        )}
      </div>
      <div className="value">
        <div className="valueWrapper">{value}</div>
      </div>
      {goal ? <div className="goal">{goal}</div> : null}
    </div>
  );
}

interface AllianceScoreColumnProps {
  leaveMarks: [boolean, boolean];
  overflowCount: number;
  classifiedCount: number;
  patternCount: number;
  mirrored?: boolean;
}

function AllianceScoreColumn({
  leaveMarks,
  overflowCount,
  classifiedCount,
  patternCount,
  mirrored = false,
}: AllianceScoreColumnProps) {
  return (
    <div className={`scoreSection ${mirrored ? 'right' : ''}`.trim()}>
      <div className="d-flex flex-column">
        <ScorePill
          icon="gamepad"
          value={
            <span className="leave-marks">
              <LeaveMarks left={leaveMarks[0]} />
              <LeaveMarks left={leaveMarks[1]} />
            </span>
          }
        />
        <ScorePill icon="pattern" value={patternCount} className="mt-3" />
      </div>
      <div className="d-flex flex-column">
        <ScorePill icon="arrow" value={overflowCount} goal={`/${MOVEMENT_RP_THRESHOLD}`} />
        <ScorePill icon="artifact" value={classifiedCount} className="mt-3" />
      </div>
    </div>
  );
}

export interface MatchFieldOverlayProps {
  snapshot: MatchSnapshot;
  visible?: boolean;
  eventName?: string;
  matchName?: string;
  redTeams?: [string, string];
  blueTeams?: [string, string];
  alliance?: Alliance;
  matchGameState?: MatchState | null;
}

export function MatchFieldOverlay({
  snapshot,
  visible = true,
  eventName = 'FTC Sim',
  matchName = 'Practice Match',
  redTeams = DEFAULT_RED_TEAMS,
  blueTeams = DEFAULT_BLUE_TEAMS,
  alliance = 'blue',
  matchGameState = null,
}: MatchFieldOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const motifRef = useRef<ObeliskMotifId>('21');

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !visible) return;

    const updateScale = () => {
      const width = root.getBoundingClientRect().width;
      if (width > 0) {
        root.style.setProperty('--display-scale', String(fitHudScale(width)));
      }
    };

    updateScale();
    requestAnimationFrame(updateScale);
    const observer = new ResizeObserver(updateScale);
    observer.observe(root);
    return () => observer.disconnect();
  }, [visible, snapshot.phase]);

  const motifId = matchGameState?.obeliskMotif ?? motifRef.current;
  if (matchGameState?.obeliskMotif) {
    motifRef.current = matchGameState.obeliskMotif;
  }
  const motifColors = DECODE_RULES.motifs[motifId];

  const redStats = allianceHudStats(matchGameState, 'red');
  const blueStats = allianceHudStats(matchGameState, 'blue');

  const simLeave = (matchGameState?.score.leave ?? 0) > 0;
  const redLeave: [boolean, boolean] =
    alliance === 'red' ? [simLeave, false] : [false, false];
  const blueLeave: [boolean, boolean] =
    alliance === 'blue' ? [simLeave, false] : [false, false];

  return (
    <div
      ref={rootRef}
      className={`ftc-broadcast-overlay${visible ? '' : ' ftc-broadcast-overlay--hidden'}`}
      aria-hidden={!visible}
      aria-live="polite"
    >
      <div className="displayContainer matchPage ftc-hud-only">
        <div className="oneThirdContainer">
          <div className="titleBar">
            <div className="themeLogoWrapper">
              <img className="themeLogo" src={THEME_LOGO} alt="FIRST" />
            </div>
            <div className="eventName text">
              <span>{eventName}</span>
            </div>
            <div className="bar" />
            <div className="matchName text">{matchName}</div>
            <div className="gameLogoWrapper">
              <img className="gameLogo" src={GAME_LOGO} alt="DECODE" />
            </div>
          </div>

          <div className="overlayContent">
            <div id="redNumbers" className="teamNumbers left number-count-2 overlay">
              <div className="teamNumber team1 redNumber">{redTeams[0]}</div>
              <div className="teamNumber team2 redNumber">{redTeams[1]}</div>
            </div>

            <div id="blueNumbers" className="teamNumbers right number-count-2 overlay">
              <div className="teamNumber team1 blueNumber">{blueTeams[0]}</div>
              <div className="teamNumber team2 blueNumber">{blueTeams[1]}</div>
            </div>

            <div className="scoreBackground left red">
              <svg width="862" height="180">
                <polygon points="0,0 862,0 862,180 637,180 637,22 0,22" />
              </svg>
            </div>
            <div className="scoreBackground right blue">
              <svg width="862" height="180">
                <polygon points="0,0 862,0 862,22 225,22 225,180 0,180" />
              </svg>
            </div>

            <div className="totalScoreWrapper left short">
              <div className="allianceSeed">Red</div>
              <div className="scoreTotal short">{redStats.total}</div>
            </div>
            <div className="totalScoreWrapper right short">
              <div className="allianceSeed">Blue</div>
              <div className="scoreTotal short">{blueStats.total}</div>
            </div>

            <div className="overlayScoreWrapper red">
              <AllianceScoreColumn
                leaveMarks={redLeave}
                overflowCount={redStats.overflow}
                classifiedCount={redStats.classified}
                patternCount={redStats.pattern}
              />
            </div>

            <div className="overlayScoreWrapper blue right">
              <AllianceScoreColumn
                leaveMarks={blueLeave}
                overflowCount={blueStats.overflow}
                classifiedCount={blueStats.classified}
                patternCount={blueStats.pattern}
                mirrored
              />
            </div>

            <div className="timer">
              <span className="timerDisplay">{formatBroadcastTimer(snapshot)}</span>
              <div className="artifacts" aria-label={`Obelisk pattern ${MOTIF_LABELS[motifId]}`}>
                {motifColors.map((color, index) => (
                  <div key={`${motifId}-${color}-${index}`} className={`artifact artifact-${index + 1}`}>
                    <img src={ARTIFACT_SRC[color]} alt="" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {snapshot.paused && <div className="match-badge">PAUSED</div>}
    </div>
  );
}
