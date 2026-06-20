import { describe, expect, it } from 'vitest';
import { InputBuffer } from './input-buffer.js';

describe('InputBuffer', () => {
  it('holds latest frame across reads', () => {
    const buffer = new InputBuffer();
    buffer.set({
      seq: 1,
      robotId: 'player',
      drive: { forward: 1, strafe: 0, turn: 0 },
      mechanism: {},
      shootEdge: false,
    });
    expect(buffer.peekLatest()?.drive.forward).toBe(1);
    expect(buffer.peekLatest()?.drive.forward).toBe(1);
  });

  it('clears shootEdge after clearEdges', () => {
    const buffer = new InputBuffer();
    buffer.set({
      seq: 2,
      robotId: 'player',
      drive: { forward: 0, strafe: 0, turn: 0 },
      mechanism: { shoot: true },
      shootEdge: true,
      gateEdge: true,
    });
    buffer.clearEdges();
    expect(buffer.peekLatest()?.shootEdge).toBe(false);
    expect(buffer.peekLatest()?.gateEdge).toBe(false);
    expect(buffer.peekLatest()?.mechanism.shoot).toBe(true);
  });
});
