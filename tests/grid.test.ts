import { describe, expect, it } from 'vitest';
import {
  cellAreaHectares,
  createGrid,
  gridRange,
  sampleAt,
  sampleBilinear,
} from '../src/core/grid';

describe('createGrid', () => {
  it('rejects degenerate dimensions and cell sizes', () => {
    expect(() => createGrid(1, 4, 10)).toThrow(RangeError);
    expect(() => createGrid(4.5, 4, 10)).toThrow(RangeError);
    expect(() => createGrid(4, 4, 0)).toThrow(RangeError);
  });

  it('allocates row-major storage', () => {
    const grid = createGrid(3, 2, 5);
    expect(grid.data.length).toBe(6);
    expect(cellAreaHectares(grid)).toBeCloseTo(0.0025, 8);
  });
});

describe('sampling', () => {
  const grid = createGrid(2, 2, 10);
  grid.data.set([0, 10, 20, 30]);

  it('clamps nearest-neighbour lookups to the edge', () => {
    expect(sampleAt(grid, -5, -5)).toBe(0);
    expect(sampleAt(grid, 99, 99)).toBe(30);
  });

  it('interpolates between the four surrounding samples', () => {
    expect(sampleBilinear(grid, 0, 0)).toBeCloseTo(0, 6);
    expect(sampleBilinear(grid, 1, 0)).toBeCloseTo(10, 6);
    expect(sampleBilinear(grid, 0.5, 0)).toBeCloseTo(5, 6);
    expect(sampleBilinear(grid, 0.5, 0.5)).toBeCloseTo(15, 6);
  });

  it('clamps bilinear lookups outside the grid', () => {
    expect(sampleBilinear(grid, -3, 0.5)).toBeCloseTo(10, 6);
    expect(sampleBilinear(grid, 5, 5)).toBeCloseTo(30, 6);
  });
});

describe('gridRange', () => {
  it('reports the min and max samples', () => {
    const grid = createGrid(2, 2, 1);
    grid.data.set([3, -1, 7, 0]);
    expect(gridRange(grid)).toEqual({ min: -1, max: 7 });
  });
});
