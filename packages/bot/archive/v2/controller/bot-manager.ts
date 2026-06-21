import type { BotSlotConfig, BotWorldSnapshot, Difficulty } from '../types.js';
import { BlackboardRegistry } from '../cognition/blackboard.js';
import { buildDecodeFieldGraph } from '../navigation/field-graph.js';
import { MultiAgentPlanner, type BotPlanRequest, type BotRole } from '../navigation/multi-agent-planner.js';
import { BotController } from './bot-controller.js';
import { BotDebugLog, type BotDebugLogEntry } from '../debug/bot-debug-log.js';

const fieldGraph = buildDecodeFieldGraph();
const multiAgentPlanner = new MultiAgentPlanner(fieldGraph.nodes, fieldGraph.edges);

export class BotManager {
  private controllers = new Map<string, BotController>();
  private blackboards = new BlackboardRegistry();
  private slotConfigs: BotSlotConfig[] = [];
  private debugLog = new BotDebugLog();
  private planAccumulator = 0;

  setDebugLogging(enabled: boolean): void {
    this.debugLog.setEnabled(enabled);
  }

  getDebugLogs(): BotDebugLogEntry[] {
    return this.debugLog.getEntries();
  }

  setSlots(slots: BotSlotConfig[]): void {
    this.slotConfigs = slots;
    const enabledIds = new Set(slots.filter((slot) => slot.enabled).map((slot) => slot.robotId));

    for (const id of enabledIds) {
      if (!this.controllers.has(id)) {
        const cfg = slots.find((slot) => slot.robotId === id)!;
        this.controllers.set(
          id,
          new BotController(id, this.blackboards, cfg.difficulty, this.debugLog),
        );
      } else {
        const cfg = slots.find((slot) => slot.robotId === id)!;
        this.controllers.get(id)!.setDifficulty(cfg.difficulty);
        this.controllers.get(id)!.setEnabled(true);
      }
    }

    for (const [id, controller] of this.controllers) {
      if (!enabledIds.has(id as BotSlotConfig['robotId'])) {
        controller.setEnabled(false);
      }
    }
  }

  getSlots(): BotSlotConfig[] {
    return [...this.slotConfigs];
  }

  getMetrics(): Record<string, import('../types.js').BotMetrics> {
    const metrics: Record<string, import('../types.js').BotMetrics> = {};
    for (const [id, controller] of this.controllers) {
      metrics[id] = controller.getMetrics();
    }
    return metrics;
  }

  private roleForTask(kind: string): BotRole {
    if (kind === 'score') return 'scorer';
    if (kind === 'park') return 'park';
    if (kind === 'defend') return 'defender';
    return 'collector';
  }

  tick(world: BotWorldSnapshot, dt: number): Map<string, import('../types.js').BotDriveSample> {
    const outputs = new Map<string, import('../types.js').BotDriveSample>();

    this.planAccumulator += dt;
    if (this.planAccumulator >= 0.2) {
      this.planAccumulator = 0;
      const requests: BotPlanRequest[] = [];
      for (const slot of this.slotConfigs) {
        if (!slot.enabled || world.humanInputRobotIds.has(slot.robotId)) continue;
        const controller = this.controllers.get(slot.robotId);
        if (!controller) continue;
        const debug = controller.getDebugState();
        requests.push({
          robotId: slot.robotId,
          role: this.roleForTask(debug.task),
          from: world.robots.find((r) => r.id === slot.robotId)?.pose ?? { x: 72, y: 72, heading: 0 },
          goal: debug.target ?? { x: 72, y: 72 },
          alliance: world.robots.find((r) => r.id === slot.robotId)?.alliance ?? 'blue',
          goalNodeHint: undefined,
        });
      }
      if (requests.length > 1) {
        multiAgentPlanner.planAll(requests);
      }
    }

    for (const slot of this.slotConfigs) {
      if (!slot.enabled) continue;
      if (world.humanInputRobotIds.has(slot.robotId)) continue;

      let controller = this.controllers.get(slot.robotId);
      if (!controller) {
        controller = new BotController(slot.robotId, this.blackboards, slot.difficulty, this.debugLog);
        this.controllers.set(slot.robotId, controller);
      }

      const sample = controller.tick(world, dt);
      if (sample) {
        outputs.set(slot.robotId, sample);
      }
    }

    return outputs;
  }

  getDebugStates(): import('../types.js').BotDebugState[] {
    return [...this.controllers.values()].map((controller) => controller.getDebugState());
  }

  isBotControlled(robotId: string): boolean {
    return this.slotConfigs.some((slot) => slot.enabled && slot.robotId === robotId);
  }

  reset(): void {
    this.blackboards.clear();
    this.debugLog.clear();
    for (const controller of this.controllers.values()) {
      controller.reset();
    }
  }
}

export function defaultPracticeBotSlots(difficulty: Difficulty = 'normal'): BotSlotConfig[] {
  return [
    { robotId: 'blue-near', enabled: true, difficulty },
    { robotId: 'red-far', enabled: true, difficulty },
    { robotId: 'red-near', enabled: true, difficulty },
  ];
}

export type { BotDebugLogEntry };
export { BotController } from './bot-controller.js';
