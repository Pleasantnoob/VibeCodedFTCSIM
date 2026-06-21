import type { ArtifactColor, Alliance, MatchPhase, MatchRobotSnapshot, MatchState, ObeliskMotifId, ScoreBreakdown } from './types.js';
import { getDecodeRules } from './rules-loader.js';
import {
  emptyScore,
  evaluateBaseReturn,
  robotAnyPartInZone,
  robotFootprintsContact,
  robotInAnyLaunchZone,
  sumScore,
} from './geometry.js';
import { countPatternMatchesForAlliance } from './pattern.js';
import type { FieldDefinition, FieldZoneDefinition, Vector2 } from '@ftc-sim/field';

export interface RulesEngineContext {
  field: FieldDefinition;
  alliance: Alliance;
  motif?: ObeliskMotifId;
  seed?: number;
}

function emptyAllianceScoreState() {
  return {
    autoScore: emptyScore(),
    teleopScore: emptyScore(),
    score: emptyScore(),
  };
}

function emptyFoulLedger() {
  return { pointsReceived: 0, minorCommitted: 0, majorCommitted: 0 };
}

function opponent(alliance: Alliance): Alliance {
  return alliance === 'red' ? 'blue' : 'red';
}

const PARKING_RANK: Record<'none' | 'partial' | 'full', number> = {
  none: 0,
  partial: 1,
  full: 2,
};

function maxParkingStatus(
  a: 'none' | 'partial' | 'full',
  b: 'none' | 'partial' | 'full',
): 'none' | 'partial' | 'full' {
  return PARKING_RANK[a] >= PARKING_RANK[b] ? a : b;
}

export class DecodeRulesEngine {
  private rules = getDecodeRules();
  private state: MatchState;
  private patternScored: Record<'auto' | 'teleop', boolean> = { auto: false, teleop: false };
  private foulCooldownUntil = new Map<string, number>();
  private forcedFullBaseRobots = new Set<string>();
  private autoPeriodEntered = false;

  constructor(private ctx: RulesEngineContext) {
    this.state = this.createInitialState(ctx.motif ?? this.randomMotif(ctx.seed ?? 42));
  }

  getState(): MatchState {
    return this.state;
  }

  getRules() {
    return this.rules;
  }

  reset(motif?: ObeliskMotifId): void {
    this.patternScored = { auto: false, teleop: false };
    this.foulCooldownUntil.clear();
    this.forcedFullBaseRobots.clear();
    this.autoPeriodEntered = false;
    this.state = this.createInitialState(motif ?? this.randomMotif(this.ctx.seed ?? 42));
  }

  syncPhase(phase: MatchPhase, timeElapsed: number): void {
    if (phase === 'auto') this.autoPeriodEntered = true;
    this.state.phase = phase;
    this.state.timeElapsed = timeElapsed;
  }

  private randomMotif(seed: number): ObeliskMotifId {
    const ids: ObeliskMotifId[] = ['21', '22', '23'];
    return ids[Math.abs(seed) % 3];
  }

  createInitialState(motif: ObeliskMotifId): MatchState {
    return {
      phase: 'setup',
      timeElapsed: 0,
      timeRemainingInPhase: 0,
      alliance: this.ctx.alliance,
      obeliskMotif: motif,
      score: emptyScore(),
      autoScore: emptyScore(),
      teleopScore: emptyScore(),
      byAlliance: {
        red: emptyAllianceScoreState(),
        blue: emptyAllianceScoreState(),
      },
      gateOpen: { red: false, blue: false },
      rampOccupancy: {
        red: Array(this.rules.rampSlots).fill(null),
        blue: Array(this.rules.rampSlots).fill(null),
      },
      fouls: { red: emptyFoulLedger(), blue: emptyFoulLedger() },
      robotParking: {},
      parkingScored: false,
      robotLeave: {},
      leaveScored: false,
      events: [],
    };
  }

  setGateOpen(alliance: Alliance, open: boolean): void {
    this.state.gateOpen[alliance] = open;
    if (open) {
      this.log(this.state.timeElapsed, 'gate', `${alliance} gate opened`);
    }
  }

  classifyArtifact(basinAlliance: Alliance, color: ArtifactColor, classified: boolean): void {
    const points = classified ? this.rules.scoring.classified : this.rules.scoring.overflow;
    const allianceState = this.state.byAlliance[basinAlliance];
    const bucket = this.state.phase === 'auto' ? allianceState.autoScore : allianceState.teleopScore;
    if (classified) bucket.classified += points;
    else bucket.overflow += points;
    this.recomputeAllianceTotal(basinAlliance);
    this.syncLegacyScore();
    this.log(
      this.state.timeElapsed,
      'score',
      `${basinAlliance.toUpperCase()} ${classified ? 'CLASSIFIED' : 'OVERFLOW'} ${color} +${points}`,
    );
    if (classified) {
      const ramp = this.state.rampOccupancy[basinAlliance];
      const idx = ramp.findIndex((s) => s === null);
      if (idx >= 0) ramp[idx] = color;
    }
  }

  removeFromRamp(alliance: Alliance, slotIndex: number): void {
    if (slotIndex >= 0 && slotIndex < this.state.rampOccupancy[alliance].length) {
      this.state.rampOccupancy[alliance][slotIndex] = null;
    }
  }

  /** Manual §10.5.3 E — LEAVE assessed at end of AUTO (3 pts per robot, once each). */
  evaluateAutoLeave(robots: MatchRobotSnapshot[]): number {
    if (!this.autoPeriodEntered) return 0;
    if (this.state.leaveScored) return 0;
    this.state.leaveScored = true;

    const launchZones = this.ctx.field.zones.filter((z) => z.type === 'launch_zone');
    let awarded = 0;

    for (const robot of robots) {
      if (robotInAnyLaunchZone(robot.footprint, launchZones)) continue;
      const points = this.rules.scoring.leave;
      const bucket = this.state.byAlliance[robot.alliance].autoScore;
      bucket.leave += points;
      this.state.robotLeave[robot.id] = true;
      awarded += points;
      this.recomputeAllianceTotal(robot.alliance);
      this.log(
        this.state.timeElapsed,
        'score',
        `${robot.alliance.toUpperCase()} ${robot.id} LEAVE +${points}`,
      );
    }

    if (awarded > 0) {
      this.syncLegacyScore();
    }
    return awarded;
  }

  evaluatePattern(period: 'auto' | 'teleop'): number {
    if (this.patternScored[period]) return 0;
    this.patternScored[period] = true;

    let totalMatches = 0;
    for (const alliance of ['red', 'blue'] as const) {
      // Pattern only counts when the gate is closed and retaining ramp artifacts (G10.5.2).
      if (this.state.gateOpen[alliance]) continue;

      const matches = countPatternMatchesForAlliance(
        this.state.rampOccupancy[alliance],
        this.state.obeliskMotif,
      );
      if (matches === 0) continue;

      const points = matches * this.rules.scoring.patternPerArtifact;
      const bucket =
        period === 'auto'
          ? this.state.byAlliance[alliance].autoScore
          : this.state.byAlliance[alliance].teleopScore;
      bucket.pattern += points;
      bucket.patternMatches += matches;
      this.recomputeAllianceTotal(alliance);
      totalMatches += matches;
      this.log(
        this.state.timeElapsed,
        'score',
        `${alliance.toUpperCase()} PATTERN +${points} (${matches}/9 indices, ${period})`,
      );
    }

    this.syncLegacyScore();
    return totalMatches;
  }

  countPatternMatches(alliance: Alliance = this.ctx.alliance): number {
    return countPatternMatchesForAlliance(this.state.rampOccupancy[alliance], this.state.obeliskMotif);
  }

  /** G417 — opponent opened this alliance's gate. */
  recordOpponentGateOpened(offender: Alliance, victim: Alliance): void {
    const cooldownKey = `gate417:${offender}:${victim}`;
    this.commitMajorFoul(offender, victim, null, 'G417 opponent gate opened', cooldownKey, 0);
  }

  /** G418 — one major foul per artifact released from opponent ramp. */
  recordOpponentRampArtifactReleased(offender: Alliance, victim: Alliance, artifactId: string): void {
    const cooldownKey = `gate418:${offender}:${victim}:${artifactId}`;
    this.commitMajorFoul(offender, victim, null, `G418 ramp artifact ${artifactId}`, cooldownKey, 0);
  }

  /** @deprecated Use evaluateMatchParking for multi-robot endgame scoring. */
  evaluateBase(robotFootprint: Vector2[], alliance: Alliance): void {
    this.evaluateMatchParking([{ id: 'robot', alliance, footprint: robotFootprint }]);
  }

  /** Remember best BASE contact during endgame (full beats partial). */
  trackMatchParkingProgress(robots: MatchRobotSnapshot[]): void {
    for (const robot of robots) {
      const base = this.getZone('base_zone', robot.alliance);
      if (!base) continue;
      const now = this.forcedFullBaseRobots.has(robot.id)
        ? 'full'
        : evaluateBaseReturn(robot.footprint, base.polygon);
      const prev = this.state.robotParking[robot.id] ?? 'none';
      this.state.robotParking[robot.id] = maxParkingStatus(prev, now);
    }
  }

  /** Score BASE parking for every robot on the field (once per match). */
  evaluateMatchParking(robots: MatchRobotSnapshot[]): void {
    if (this.state.parkingScored) return;
    this.state.parkingScored = true;

    for (const alliance of ['red', 'blue'] as const) {
      const base = this.getZone('base_zone', alliance);
      if (!base) continue;

      const allianceRobots = robots.filter((robot) => robot.alliance === alliance);
      let fullCount = 0;

      for (const robot of allianceRobots) {
        const live = this.forcedFullBaseRobots.has(robot.id)
          ? 'full'
          : evaluateBaseReturn(robot.footprint, base.polygon);
        let result = maxParkingStatus(live, this.state.robotParking[robot.id] ?? 'none');

        this.state.robotParking[robot.id] = result;
        const bucket = this.state.byAlliance[alliance].teleopScore;

        if (result === 'full') {
          bucket.base += this.rules.scoring.baseFull;
          fullCount += 1;
          this.log(this.state.timeElapsed, 'score', `${alliance.toUpperCase()} ${robot.id} BASE full +${this.rules.scoring.baseFull}`);
        } else if (result === 'partial') {
          bucket.base += this.rules.scoring.basePartial;
          this.log(this.state.timeElapsed, 'score', `${alliance.toUpperCase()} ${robot.id} BASE partial +${this.rules.scoring.basePartial}`);
        }
      }

      if (fullCount >= 2) {
        const bucket = this.state.byAlliance[alliance].teleopScore;
        bucket.allianceBonus += this.rules.scoring.allianceBothFullBase;
        this.log(
          this.state.timeElapsed,
          'score',
          `${alliance.toUpperCase()} both robots fully returned +${this.rules.scoring.allianceBothFullBase}`,
        );
      }

      this.recomputeAllianceTotal(alliance);
    }

    this.syncLegacyScore();
  }

  /** G425 secret tunnel + G427/G428 endgame BASE contact fouls. */
  tickContactRules(robots: MatchRobotSnapshot[], teleopTimeRemainingSec: number): void {
    if (this.state.phase !== 'teleop') return;

    const endgame = teleopTimeRemainingSec <= this.rules.endgameSec;
    const secretTunnels = {
      red: this.getZone('secret_tunnel', 'red'),
      blue: this.getZone('secret_tunnel', 'blue'),
    };
    const baseZones = {
      red: this.getZone('base_zone', 'red'),
      blue: this.getZone('base_zone', 'blue'),
    };

    for (let i = 0; i < robots.length; i++) {
      for (let j = i + 1; j < robots.length; j++) {
        const a = robots[i]!;
        const b = robots[j]!;
        if (a.alliance === b.alliance) continue;
        if (!robotFootprintsContact(a.footprint, b.footprint)) continue;

        this.checkSecretTunnelFoul(a, b, secretTunnels);
        this.checkSecretTunnelFoul(b, a, secretTunnels);

        if (endgame) {
          this.checkEndgameBaseContactPair(a, b, baseZones);
        }
      }
    }
  }

  private checkSecretTunnelFoul(
    violator: MatchRobotSnapshot,
    victim: MatchRobotSnapshot,
    tunnels: Record<Alliance, FieldZoneDefinition | null>,
  ): void {
    const victimAlliance = victim.alliance;
    const tunnel = tunnels[victimAlliance];
    if (!tunnel) return;
    if (!robotAnyPartInZone(violator.footprint, tunnel.polygon)) return;

    const cooldownKey = `secret:${violator.id}:${victimAlliance}`;
    if (!this.canCommitFoul(cooldownKey, this.rules.fouls.foulCooldownSec)) return;

    this.commitMinorFoul(violator.alliance, victimAlliance, 'G425 secret tunnel contact', cooldownKey);
  }

  private checkEndgameBaseContactPair(
    a: MatchRobotSnapshot,
    b: MatchRobotSnapshot,
    bases: Record<Alliance, FieldZoneDefinition | null>,
  ): void {
    const aInOwn = robotAnyPartInZone(a.footprint, bases[a.alliance]?.polygon ?? []);
    const bInOwn = robotAnyPartInZone(b.footprint, bases[b.alliance]?.polygon ?? []);
    const aInOpp = robotAnyPartInZone(a.footprint, bases[opponent(a.alliance)]?.polygon ?? []);
    const bInOpp = robotAnyPartInZone(b.footprint, bases[opponent(b.alliance)]?.polygon ?? []);

    if (!aInOwn && !bInOwn && !aInOpp && !bInOpp) return;

    if (aInOpp) {
      this.tryParkingContactFoul(a, b, 'G427 opponent BASE');
    }
    if (bInOpp) {
      this.tryParkingContactFoul(b, a, 'G427 opponent BASE');
    }
    if (aInOwn && !bInOwn) {
      this.tryParkingContactFoul(b, a, 'G427 parked BASE contact');
    }
    if (bInOwn && !aInOwn) {
      this.tryParkingContactFoul(a, b, 'G427 parked BASE contact');
    }
  }

  private tryParkingContactFoul(
    offender: MatchRobotSnapshot,
    parked: MatchRobotSnapshot,
    reason: string,
  ): void {
    const cooldownKey = `base:${offender.id}:${parked.id}`;
    const cooldown = this.rules.fouls.foulCooldownSec;
    if (!this.canCommitFoul(cooldownKey, cooldown)) return;
    this.commitMajorFoul(offender.alliance, parked.alliance, parked.id, reason, cooldownKey);
  }

  private canCommitFoul(key: string, cooldownSec: number): boolean {
    const until = this.foulCooldownUntil.get(key) ?? 0;
    return this.state.timeElapsed >= until;
  }

  private setFoulCooldown(key: string, cooldownSec: number): void {
    this.foulCooldownUntil.set(key, this.state.timeElapsed + cooldownSec);
  }

  private commitMinorFoul(offender: Alliance, victim: Alliance, message: string, cooldownKey: string): void {
    const points = this.rules.fouls.minor;
    this.state.fouls[offender].minorCommitted += 1;
    this.state.fouls[victim].pointsReceived += points;
    this.state.byAlliance[victim].teleopScore.foulPoints += points;
    this.recomputeAllianceTotal(victim);
    this.syncLegacyScore();
    this.setFoulCooldown(cooldownKey, this.rules.fouls.foulCooldownSec);
    this.log(this.state.timeElapsed, 'foul', `MINOR FOUL ${offender.toUpperCase()} → ${victim.toUpperCase()} +${points} (${message})`);
  }

  private commitMajorFoul(
    offender: Alliance,
    victim: Alliance,
    victimRobotId: string | null,
    message: string,
    cooldownKey: string,
    cooldownSec = this.rules.fouls.foulCooldownSec,
  ): void {
    const points = this.rules.fouls.major;
    this.state.fouls[offender].majorCommitted += 1;
    this.state.fouls[victim].pointsReceived += points;
    this.state.byAlliance[victim].teleopScore.foulPoints += points;
    if (victimRobotId) {
      this.awardForcedFullBase(victimRobotId, victim);
    }
    this.recomputeAllianceTotal(victim);
    this.recomputeAllianceTotal(offender);
    this.syncLegacyScore();
    if (cooldownSec > 0) {
      this.setFoulCooldown(cooldownKey, cooldownSec);
    }
    this.log(this.state.timeElapsed, 'foul', `MAJOR FOUL ${offender.toUpperCase()} → ${victim.toUpperCase()} +${points} (${message})`);
  }

  private awardForcedFullBase(robotId: string, alliance: Alliance): void {
    if (this.forcedFullBaseRobots.has(robotId)) return;
    this.forcedFullBaseRobots.add(robotId);
    this.state.robotParking[robotId] = 'full';

    if (this.state.parkingScored) {
      const bucket = this.state.byAlliance[alliance].teleopScore;
      bucket.base += this.rules.scoring.baseFull;
      this.recomputeAllianceTotal(alliance);
      this.syncLegacyScore();
    }

    this.log(
      this.state.timeElapsed,
      'score',
      `${alliance.toUpperCase()} ${robotId} awarded forced FULL BASE (+${this.rules.scoring.baseFull})`,
    );
  }

  private recomputeAllianceTotal(alliance: Alliance): void {
    const merge = (a: ScoreBreakdown, b: ScoreBreakdown): ScoreBreakdown => ({
      leave: a.leave + b.leave,
      classified: a.classified + b.classified,
      overflow: a.overflow + b.overflow,
      depot: a.depot + b.depot,
      pattern: a.pattern + b.pattern,
      patternMatches: a.patternMatches + b.patternMatches,
      base: a.base + b.base,
      allianceBonus: a.allianceBonus + b.allianceBonus,
      foulPoints: a.foulPoints + b.foulPoints,
      total: 0,
    });
    const allianceState = this.state.byAlliance[alliance];
    allianceState.score = merge(allianceState.autoScore, allianceState.teleopScore);
    allianceState.score.total = sumScore(allianceState.score);
  }

  private syncLegacyScore(): void {
    const playing = this.state.byAlliance[this.ctx.alliance];
    this.state.autoScore = { ...playing.autoScore };
    this.state.teleopScore = { ...playing.teleopScore };
    this.state.score = { ...playing.score };
  }

  private getZone(type: string, alliance: Alliance): FieldZoneDefinition | null {
    return (
      this.ctx.field.zones.find((z) => z.type === type && z.alliance === alliance) ??
      this.ctx.field.zones.find((z) => z.id.includes(type) && z.alliance === alliance) ??
      null
    );
  }

  private log(t: number, type: string, message: string, data?: Record<string, unknown>): void {
    this.state.events.push({ t, type, message, data });
  }
}

export { DECODE_RULES, validateRules } from './rules-loader.js';
