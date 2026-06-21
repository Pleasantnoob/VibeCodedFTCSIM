import type { ArtifactColor } from '@ftc-sim/game-decode';

export type BotRole = 'scorer' | 'collector' | 'defender' | 'park';

export interface AllianceBlackboardV2 {
  artifactClaims: Set<string>;
  spikeRowAssignments: Map<string, number>;
  rampIntent: boolean;
  motifNeed: ArtifactColor | null;
  parkReservation: string | null;
  defenderLane: 'near' | 'far' | null;
  roles: Map<string, BotRole>;
}

export class AllianceBlackboard {
  private claimedArtifacts = new Set<string>();
  private spikeRows = new Map<string, number>();
  private rampIntentFlag = false;
  private motifNeedColor: ArtifactColor | null = null;
  private parkReservationId: string | null = null;
  private defenderLaneValue: 'near' | 'far' | null = null;
  private roles = new Map<string, BotRole>();

  claim(artifactId: string): void {
    this.claimedArtifacts.add(artifactId);
  }

  release(artifactId: string): void {
    this.claimedArtifacts.delete(artifactId);
  }

  isClaimed(artifactId: string): boolean {
    return this.claimedArtifacts.has(artifactId);
  }

  releaseCollected(artifacts: Array<{ id: string; phase: string }>): void {
    for (const id of [...this.claimedArtifacts]) {
      const artifact = artifacts.find((entry) => entry.id === id);
      if (!artifact || artifact.phase !== 'onField') {
        this.claimedArtifacts.delete(id);
      }
    }
  }

  assignSpikeRow(robotId: string, row: number): void {
    this.spikeRows.set(robotId, row);
  }

  spikeRowFor(robotId: string): number | undefined {
    return this.spikeRows.get(robotId);
  }

  setRampIntent(active: boolean): void {
    this.rampIntentFlag = active;
  }

  get rampIntent(): boolean {
    return this.rampIntentFlag;
  }

  setMotifNeed(color: ArtifactColor | null): void {
    this.motifNeedColor = color;
  }

  get motifNeed(): ArtifactColor | null {
    return this.motifNeedColor;
  }

  reservePark(robotId: string | null): void {
    this.parkReservationId = robotId;
  }

  isParkReservedBy(otherId: string): boolean {
    return this.parkReservationId !== null && this.parkReservationId !== otherId;
  }

  setDefenderLane(lane: 'near' | 'far' | null): void {
    this.defenderLaneValue = lane;
  }

  get defenderLane(): 'near' | 'far' | null {
    return this.defenderLaneValue;
  }

  setRole(robotId: string, role: BotRole): void {
    this.roles.set(robotId, role);
  }

  roleFor(robotId: string): BotRole | undefined {
    return this.roles.get(robotId);
  }

  getRoles(): ReadonlyMap<string, BotRole> {
    return this.roles;
  }

  snapshot(): AllianceBlackboardV2 {
    return {
      artifactClaims: new Set(this.claimedArtifacts),
      spikeRowAssignments: new Map(this.spikeRows),
      rampIntent: this.rampIntentFlag,
      motifNeed: this.motifNeedColor,
      parkReservation: this.parkReservationId,
      defenderLane: this.defenderLaneValue,
      roles: new Map(this.roles),
    };
  }

  clear(): void {
    this.claimedArtifacts.clear();
    this.spikeRows.clear();
    this.rampIntentFlag = false;
    this.motifNeedColor = null;
    this.parkReservationId = null;
    this.defenderLaneValue = null;
    this.roles.clear();
  }
}

export class BlackboardRegistry {
  private boards = new Map<string, AllianceBlackboard>();

  forAlliance(alliance: 'blue' | 'red'): AllianceBlackboard {
    let board = this.boards.get(alliance);
    if (!board) {
      board = new AllianceBlackboard();
      this.boards.set(alliance, board);
    }
    return board;
  }

  clear(): void {
    this.boards.clear();
  }
}
