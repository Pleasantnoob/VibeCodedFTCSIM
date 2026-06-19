import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeServerMessage, encodeMessage, hashBarriers } from './codec.js';
import { SIM_NET_PROTOCOL_VERSION } from './protocol.js';

describe('net codec', () => {
  it('roundtrips client hello', () => {
    const msg = {
      type: 'hello' as const,
      protocol: SIM_NET_PROTOCOL_VERSION,
      appVersion: '0.2.0',
      displayName: 'Test',
      intent: 'host' as const,
    };
    const decoded = decodeClientMessage(encodeMessage(msg));
    expect(decoded).toEqual(msg);
  });

  it('roundtrips server welcome', () => {
    const msg = {
      type: 'welcome' as const,
      playerId: 'p1',
      role: 'host' as const,
      robotId: 'player',
      roomConfig: { alliance: 'blue' as const, barrierHash: 'abc', artifactFriction: 0.25 },
    };
    const decoded = decodeServerMessage(encodeMessage(msg));
    expect(decoded).toEqual(msg);
  });

  it('hashes barriers deterministically', () => {
    const barriers = [{ id: 'blue_goal', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }];
    expect(hashBarriers(barriers)).toBe(hashBarriers([...barriers]));
    expect(hashBarriers(barriers)).not.toBe(hashBarriers([{ id: 'red_goal', vertices: barriers[0]!.vertices }]));
  });
});
