import { describe, expect, it } from 'vitest';
import {
  FIELD_SIZE_INCHES,
  VISUAL_FIELD_SIZE_INCHES,
  VISUAL_SCALE,
  ftcDecodeToPedro,
  pedroToFtcDecode,
  pedroToPhysics,
  physicsToPedro,
} from './coordinates.js';
import {
  createSquareFieldViewport,
  fieldPxToPedro,
  pedroToFieldPx,
} from './canvas-coords.js';

describe('coordinates', () => {
  it('converts pedro center to physics origin', () => {
    const p = pedroToPhysics({ x: 72, y: 72, heading: 0 });
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(0, 3);
  });

  it('round-trips pedro ↔ physics', () => {
    const original = { x: 24, y: 117, heading: 1.2 };
    const back = physicsToPedro(pedroToPhysics(original));
    expect(back.x).toBeCloseTo(original.x, 3);
    expect(back.y).toBeCloseTo(original.y, 3);
  });

  it('round-trips FTC decode coords', () => {
    const ftc = { x: -58.3727, y: 55.6425, heading: 0 };
    const back = pedroToFtcDecode(ftcDecodeToPedro(ftc));
    expect(back.x).toBeCloseTo(ftc.x, 1);
    expect(back.y).toBeCloseTo(ftc.y, 1);
  });
});

describe('canvas coords', () => {
  const viewport = createSquareFieldViewport(VISUAL_FIELD_SIZE_INCHES * 5);

  it('maps pedro corners to canvas corners', () => {
    const bl = pedroToFieldPx({ x: 0, y: 0 }, viewport);
    expect(bl.x).toBeCloseTo(0, 3);
    expect(bl.y).toBeCloseTo(viewport.heightPx, 3);

    const tr = pedroToFieldPx({ x: FIELD_SIZE_INCHES, y: FIELD_SIZE_INCHES }, viewport);
    expect(tr.x).toBeCloseTo(viewport.widthPx, 1);
    expect(tr.y).toBeCloseTo(0, 1);
  });

  it('round-trips pedro ↔ field pixels', () => {
    const original = { x: 132, y: 10 };
    const back = fieldPxToPedro(pedroToFieldPx(original, viewport), viewport);
    expect(back.x).toBeCloseTo(original.x, 2);
    expect(back.y).toBeCloseTo(original.y, 2);
  });

  it('uses 141.5/144 visual scale at field edge', () => {
    const edge = pedroToFieldPx({ x: FIELD_SIZE_INCHES, y: 0 }, viewport);
    expect(edge.x / viewport.scalePxPerInch).toBeCloseTo(VISUAL_FIELD_SIZE_INCHES, 2);
    expect(VISUAL_SCALE).toBeCloseTo(VISUAL_FIELD_SIZE_INCHES / FIELD_SIZE_INCHES, 5);
  });
});
