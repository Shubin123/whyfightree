import { describe, expect, it } from 'vitest';
import { createGrid } from '../src/core/grid';
import {
  BURNED_THRESHOLD,
  SEVERITY_CLASSES,
  severityClassByKey,
  severityClassFor,
  summariseSeverity,
} from '../src/core/severity';

describe('severity classes', () => {
  it('covers the real line without gaps or overlaps', () => {
    for (let i = 1; i < SEVERITY_CLASSES.length; i += 1) {
      expect(SEVERITY_CLASSES[i]!.min).toBe(SEVERITY_CLASSES[i - 1]!.max);
    }
    expect(SEVERITY_CLASSES[0]!.min).toBe(-Infinity);
    expect(SEVERITY_CLASSES.at(-1)!.max).toBe(Infinity);
  });

  it('classifies the USGS breaks on the lower bound', () => {
    expect(severityClassFor(-0.3).key).toBe('regrowth-high');
    expect(severityClassFor(-0.25).key).toBe('regrowth-low');
    expect(severityClassFor(-0.1).key).toBe('unburned');
    expect(severityClassFor(0.1).key).toBe('low');
    expect(severityClassFor(0.27).key).toBe('moderate-low');
    expect(severityClassFor(0.44).key).toBe('moderate-high');
    expect(severityClassFor(0.66).key).toBe('high');
    expect(severityClassFor(2).key).toBe('high');
  });

  it('treats nodata as unburned rather than throwing', () => {
    expect(severityClassFor(Number.NaN).key).toBe('unburned');
    expect(severityClassFor(Number.POSITIVE_INFINITY).key).toBe('unburned');
  });

  it('rejects unknown class keys', () => {
    // @ts-expect-error exercising the runtime guard with an invalid key
    expect(() => severityClassByKey('scorched')).toThrow(RangeError);
  });
});

describe('summariseSeverity', () => {
  it('accounts for every cell exactly once', () => {
    const grid = createGrid(4, 4, 10);
    grid.data.set([-0.4, -0.2, 0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.8, 0.9, 1.2, 0.2, 0, 0, 0.45, 0.66]);
    const summary = summariseSeverity(grid);

    expect(summary.totalCells).toBe(16);
    expect(summary.stats.reduce((sum, stat) => sum + stat.cells, 0)).toBe(16);
    expect(summary.stats.reduce((sum, stat) => sum + stat.fraction, 0)).toBeCloseTo(1, 10);
  });

  it('converts cell counts to hectares using the cell size', () => {
    const grid = createGrid(10, 10, 100); // 100 cells of 1 ha each
    grid.data.fill(0.8);
    const summary = summariseSeverity(grid);

    expect(summary.totalHectares).toBeCloseTo(100, 6);
    expect(summary.burnedHectares).toBeCloseTo(100, 6);
    expect(summary.stats.find((s) => s.cls.key === 'high')!.hectares).toBeCloseTo(100, 6);
  });

  it('counts only classes at or above the burned threshold as burned', () => {
    const grid = createGrid(2, 2, 100);
    grid.data.set([0.05, 0.09, 0.11, 0.9]);
    const summary = summariseSeverity(grid);

    expect(BURNED_THRESHOLD).toBe(0.1);
    expect(summary.burnedHectares).toBeCloseTo(2, 6);
    expect(summary.meanDnbr).toBeCloseTo((0.05 + 0.09 + 0.11 + 0.9) / 4, 5);
  });
});
