import type { Alliance } from '@ftc-sim/game-decode';
import type { AllianceScoreDetail, ResolvedMatchOutcome } from './match-results-assets';
import {
  MATCH_RESULTS_GAME_LOGO,
  MATCH_RESULTS_PROGRAM_LOGO,
} from './match-results-assets';

interface ResultsAlliancePanelProps {
  color: Alliance;
  score: number;
  detail: AllianceScoreDetail;
  foulPoints: number;
  teams: [string, string];
  winner: ResolvedMatchOutcome['winner'];
  rightAligned?: boolean;
}

function ResultsAlliancePanel({
  color,
  score,
  detail,
  foulPoints,
  teams,
  winner,
  rightAligned = false,
}: ResultsAlliancePanelProps) {
  const showWinner = winner === null || winner === color;
  const isWinner = winner === color;

  return (
    <div
      className={`resultsSet ${color}${rightAligned ? ' right' : ''}${showWinner ? '' : ' noWinner'}`}
    >
      <svg
        width="960"
        height="240"
        className={`scoreBackground${rightAligned ? ' right' : ''}`}
        aria-hidden
      >
        <polygon
          points={
            rightAligned
              ? '0,0 960,0 960,40 360,40 360,240 0,240'
              : '0,0 960,0 960,240 600,240 600,40 0,40'
          }
        />
      </svg>

      <div className="scoreRegion">
        <span className="allianceName">{color === 'red' ? 'Red' : 'Blue'}</span>
        <span className="scoreSpan">{score}</span>
        {showWinner ? (
          <>
            <span className={`winSpan${isWinner ? ' won' : ''}`}>{winner ? 'Winner' : 'Tie'}</span>
            {isWinner ? <i className="fa fa-trophy" aria-hidden /> : null}
          </>
        ) : null}
      </div>

      <div className="resultsUpperWrapper">
        {teams.map((team) => (
          <div key={team} className="resultsTeam">
            <span className="teamNumberColumn">{team}</span>
          </div>
        ))}
      </div>

      <div className="resultsComponents">
        <span>{detail.leave}</span>
        <span>{detail.artifact}</span>
        <span>{detail.pattern}</span>
        <span>{detail.base}</span>
        <span>{foulPoints}</span>
      </div>
    </div>
  );
}

export interface MatchResultsOverlayProps {
  outcome: ResolvedMatchOutcome;
  matchName?: string;
  eventName?: string;
  redTeams?: [string, string];
  blueTeams?: [string, string];
}

export function MatchResultsOverlay({
  outcome,
  matchName = 'Practice Match',
  eventName = 'FTC Sim',
  redTeams = ['-1', '-2'],
  blueTeams = ['-3', '-4'],
}: MatchResultsOverlayProps) {
  return (
    <div className="h-100 w-100 resultsPage" aria-live="polite">
      <div className="primaryMatchContainer">
        <div className="matchTopBar small">
          <div className="pageName">Match Results</div>
          <div className="pageTitle">{matchName}</div>
          <div className="gameLogoContainer">
            <img className="gameLogo" src={MATCH_RESULTS_GAME_LOGO} alt="DECODE" />
          </div>
        </div>

        <div className="matchBottomBar">
          <div className="programLogoContainer">
            <img className="programLogo" src={MATCH_RESULTS_PROGRAM_LOGO} alt="FIRST Tech Challenge" />
          </div>
          <div className="eventName align-middle">{eventName}</div>
        </div>

        <div className="resultsWrapper">
          <ResultsAlliancePanel
            color="red"
            score={outcome.redScore}
            detail={outcome.redDetail}
            foulPoints={outcome.redDetail.foul}
            teams={redTeams}
            winner={outcome.winner}
          />
          <ResultsAlliancePanel
            color="blue"
            score={outcome.blueScore}
            detail={outcome.blueDetail}
            foulPoints={outcome.blueDetail.foul}
            teams={blueTeams}
            winner={outcome.winner}
            rightAligned
          />

          <div className="resultsBreakdownKey">
            <span>LEAVE</span>
            <span>ARTIFACT</span>
            <span>PATTERN</span>
            <span>BASE</span>
            <span>FOUL</span>
          </div>
        </div>
      </div>
    </div>
  );
}
