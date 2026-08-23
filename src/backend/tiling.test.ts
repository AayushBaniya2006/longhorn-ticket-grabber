import { computeGridDimensions, computeTileBounds, computeMainSplit } from './tiling';

describe('computeGridDimensions', () => {
  it('returns an empty grid for no windows', () => {
    expect(computeGridDimensions(0)).toEqual({ cols: 0, rows: 0 });
  });

  it('is 1x1 for a single window', () => {
    expect(computeGridDimensions(1)).toEqual({ cols: 1, rows: 1 });
  });

  it('packs four windows into 2x2', () => {
    expect(computeGridDimensions(4)).toEqual({ cols: 2, rows: 2 });
  });

  it('packs five windows into a compact 3x2, not 3x3', () => {
    expect(computeGridDimensions(5)).toEqual({ cols: 3, rows: 2 });
  });

  it('packs nine windows into 3x3', () => {
    expect(computeGridDimensions(9)).toEqual({ cols: 3, rows: 3 });
  });
});

describe('computeTileBounds', () => {
  const area = { x: 0, y: 0, width: 1200, height: 800 };

  it('fills the whole area for a single window', () => {
    expect(computeTileBounds(0, 1, area)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it('splits four windows into quadrants', () => {
    expect(computeTileBounds(0, 4, area)).toEqual({ x: 0, y: 0, width: 600, height: 400 });
    expect(computeTileBounds(1, 4, area)).toEqual({ x: 600, y: 0, width: 600, height: 400 });
    expect(computeTileBounds(2, 4, area)).toEqual({ x: 0, y: 400, width: 600, height: 400 });
    expect(computeTileBounds(3, 4, area)).toEqual({ x: 600, y: 400, width: 600, height: 400 });
  });

  it('respects a work-area offset (e.g. a secondary monitor)', () => {
    const offset = { x: 1920, y: 0, width: 1000, height: 1000 };
    expect(computeTileBounds(0, 4, offset)).toEqual({ x: 1920, y: 0, width: 500, height: 500 });
    expect(computeTileBounds(3, 4, offset)).toEqual({ x: 2420, y: 500, width: 500, height: 500 });
  });

  it('falls back to the whole area when count is zero', () => {
    expect(computeTileBounds(0, 0, area)).toEqual(area);
  });
});

describe('computeMainSplit', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };

  it('splits 30/70 by default', () => {
    const { main, session } = computeMainSplit(area);
    expect(main).toEqual({ x: 0, y: 0, width: 300, height: 800 });
    expect(session).toEqual({ x: 300, y: 0, width: 700, height: 800 });
  });

  it('honors a custom fraction', () => {
    const { main, session } = computeMainSplit(area, 0.5);
    expect(main.width).toBe(500);
    expect(session.width).toBe(500);
    expect(session.x).toBe(500);
  });

  it('respects a work-area offset', () => {
    const { main, session } = computeMainSplit({ x: 100, y: 50, width: 1000, height: 800 }, 0.3);
    expect(main).toEqual({ x: 100, y: 50, width: 300, height: 800 });
    expect(session.x).toBe(400);
  });
});
