import { describe, expect, it } from 'vitest';
import { marchingSquares } from '../src/core/contour';
import { createGrid } from '../src/core/grid';

describe('marchingSquares', () => {
  it('returns nothing when the whole grid is on one side of the threshold', () => {
    const grid = createGrid(4, 4, 1);
    grid.data.fill(0.9);
    expect(marchingSquares(grid, 0.1)).toHaveLength(0);

    grid.data.fill(-0.5);
    expect(marchingSquares(grid, 0.1)).toHaveLength(0);
  });

  it('cuts a single cell once when one corner crosses', () => {
    const grid = createGrid(2, 2, 1);
    grid.data.set([1, 0, 0, 0]);
    const segments = marchingSquares(grid, 0.5);

    expect(segments).toHaveLength(1);
    const [segment] = segments;
    // The crossing sits halfway along both edges leaving the hot corner.
    expect(segment!.x1).toBeCloseTo(0, 6);
    expect(segment!.y1).toBeCloseTo(0.5, 6);
    expect(segment!.x2).toBeCloseTo(0.5, 6);
    expect(segment!.y2).toBeCloseTo(0, 6);
  });

  it('places the crossing by linear interpolation, not at the midpoint', () => {
    const grid = createGrid(2, 2, 1);
    grid.data.set([0, 1, 0, 0]);
    const [segment] = marchingSquares(grid, 0.25);

    // Along the top edge the threshold is a quarter of the way across.
    expect(segment!.x1).toBeCloseTo(0.25, 6);
    expect(segment!.y1).toBeCloseTo(0, 6);
  });

  it('emits two segments for a saddle', () => {
    const grid = createGrid(2, 2, 1);
    grid.data.set([1, 0, 0, 1]); // diagonally opposite corners hot
    expect(marchingSquares(grid, 0.5)).toHaveLength(2);
  });

  it('traces a closed loop around an interior patch', () => {
    const grid = createGrid(5, 5, 1);
    grid.data.fill(0);
    for (const index of [6, 7, 11, 12]) grid.data[index] = 1;
    const segments = marchingSquares(grid, 0.5);

    // A closed ring: every endpoint is shared by exactly two segments.
    const counts = new Map<string, number>();
    for (const s of segments) {
      for (const key of [`${s.x1},${s.y1}`, `${s.x2},${s.y2}`]) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    expect(segments.length).toBeGreaterThan(3);
    expect([...counts.values()].every((count) => count === 2)).toBe(true);
  });
});
